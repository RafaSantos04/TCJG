import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { HealthIndicatorService } from '@nestjs/terminus';

@Injectable()
export class SqsHealthIndicator implements OnApplicationShutdown {
  private readonly client: SQSClient;

  constructor(
    private readonly config: ConfigService,
    private readonly indicators: HealthIndicatorService,
  ) {
    this.client = new SQSClient({
      region: config.getOrThrow<string>('AWS_REGION'),
      endpoint: config.getOrThrow<string>('AWS_ENDPOINT_URL'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
      maxAttempts: 1,
    });
  }

  check() {
    return this.indicators
      .check('sqs')
      .attempt(async () => {
        const queue = await this.client.send(
          new GetQueueUrlCommand({
            QueueName: this.config.getOrThrow<string>('SQS_QUEUE_NAME'),
          }),
        );
        if (!queue.QueueUrl) throw new Error('SQS did not return a queue URL');
        await this.client.send(
          new GetQueueAttributesCommand({
            QueueUrl: this.localQueueUrl(queue.QueueUrl),
            AttributeNames: ['QueueArn'],
          }),
        );
      })
      .withTimeout(1_500);
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }

  private localQueueUrl(discoveredUrl: string): string {
    const discovered = new URL(discoveredUrl);
    const endpoint = new URL(
      this.config.getOrThrow<string>('AWS_ENDPOINT_URL'),
    );
    endpoint.pathname = discovered.pathname;
    endpoint.search = discovered.search;
    return endpoint.toString();
  }
}
