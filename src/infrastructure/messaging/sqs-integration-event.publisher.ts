import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { IntegrationEventPublisherPort } from '../../shared/application/ports/integration-event-publisher.port.js';
import type { OutboxMessage } from '../../shared/domain/entities/outbox-message.js';

@Injectable()
export class SqsIntegrationEventPublisher
  implements IntegrationEventPublisherPort, OnApplicationShutdown
{
  private readonly client: SQSClient;
  private queueUrl?: string;

  constructor(private readonly config: ConfigService) {
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

  async publish(message: OutboxMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: await this.getQueueUrl(),
        MessageBody: JSON.stringify(message.payload),
        MessageDeduplicationId: message.id,
        MessageGroupId: message.aggregateId,
      }),
    );
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }

  private async getQueueUrl(): Promise<string> {
    if (this.queueUrl) return this.queueUrl;
    const result = await this.client.send(
      new GetQueueUrlCommand({
        QueueName: this.config.getOrThrow<string>('OUTBOX_QUEUE_NAME'),
      }),
    );
    if (!result.QueueUrl) throw new Error('SQS did not return a queue URL');
    const discovered = new URL(result.QueueUrl);
    const configuredEndpoint = new URL(
      this.config.getOrThrow<string>('AWS_ENDPOINT_URL'),
    );
    configuredEndpoint.pathname = discovered.pathname;
    configuredEndpoint.search = discovered.search;
    this.queueUrl = configuredEndpoint.toString();
    return this.queueUrl;
  }
}
