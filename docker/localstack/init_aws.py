import json
import os

import boto3


endpoint = os.getenv("LOCALSTACK_ENDPOINT", "http://localstack:4566")
region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
sqs = boto3.client(
    "sqs",
    endpoint_url=endpoint,
    region_name=region,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
)

fifo_attributes = {
    "FifoQueue": "true",
    "ContentBasedDeduplication": "true",
}

dlq_url = sqs.create_queue(
    QueueName="wager-transactions-dlq.fifo",
    Attributes=fifo_attributes,
)["QueueUrl"]

dlq_arn = sqs.get_queue_attributes(
    QueueUrl=dlq_url,
    AttributeNames=["QueueArn"],
)["Attributes"]["QueueArn"]

sqs.create_queue(
    QueueName="wager-transactions.fifo",
    Attributes={
        **fifo_attributes,
        "RedrivePolicy": json.dumps(
            {
                "deadLetterTargetArn": dlq_arn,
                "maxReceiveCount": "5",
            }
        ),
    },
)

sqs.create_queue(
    QueueName="wallet-events.fifo",
    Attributes=fifo_attributes,
)

print("LocalStack SQS queues are ready.")
