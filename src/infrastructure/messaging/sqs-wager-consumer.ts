import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChangeMessageVisibilityBatchCommand,
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { MetricsService } from '../observability/metrics.service.js';
import {
  observabilityContext,
  type ObservabilityContext,
} from '../observability/observability-context.js';
import { TransientPersistenceError } from '../../shared/application/errors/persistence.error.js';
import { IdempotencyConflictError } from '../../wagering/application/errors/idempotency-conflict.error.js';
import { InboxPayloadConflictError } from '../../wagering/application/errors/inbox-payload-conflict.error.js';
import { InvalidWagerMessageError } from '../../wagering/application/errors/invalid-wager-message.error.js';
import { WagerTransactionConflictError } from '../../wagering/application/errors/wager-transaction-conflict.error.js';
import { ProcessWagerMessage } from '../../wagering/application/process-wager-message.js';

type FailureKind = 'permanent' | 'transient';

@Injectable()
export class SqsWagerConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SqsWagerConsumer.name);
  private readonly client: SQSClient;
  private queueUrl?: string;
  private deadLetterQueueUrl?: string;
  private stopping = false;
  private loopPromise?: Promise<void>;
  private receiveAbortController?: AbortController;

  constructor(
    private readonly processor: ProcessWagerMessage,
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
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

  onApplicationBootstrap(): void {
    if (!this.config.getOrThrow<boolean>('SQS_CONSUMER_ENABLED')) return;
    this.loopPromise = this.loop().catch((error: unknown) => {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.receiveAbortController?.abort();
    await this.loopPromise;
    this.client.destroy();
  }

  async runOnce(): Promise<number> {
    this.receiveAbortController = new AbortController();
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: await this.getQueueUrl(false),
        WaitTimeSeconds: this.config.getOrThrow<number>(
          'SQS_WAIT_TIME_SECONDS',
        ),
        MaxNumberOfMessages: this.config.getOrThrow<number>(
          'SQS_MAX_NUMBER_OF_MESSAGES',
        ),
        VisibilityTimeout: this.config.getOrThrow<number>(
          'SQS_VISIBILITY_TIMEOUT_SECONDS',
        ),
        MessageSystemAttributeNames: [
          'ApproximateReceiveCount',
          'MessageGroupId',
        ],
      }),
      { abortSignal: this.receiveAbortController.signal },
    );
    this.receiveAbortController = undefined;
    const messages = result.Messages ?? [];
    await this.processBatch(messages);
    return messages.length;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.runOnce();
      } catch (error) {
        if (!this.stopping) {
          this.logger.error(
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }
  }

  private async processBatch(messages: Message[]): Promise<void> {
    let nextIndex = 0;
    const concurrency = Math.min(
      messages.length,
      this.config.getOrThrow<number>('SQS_CONSUMER_CONCURRENCY'),
    );
    const workers = Array.from({ length: concurrency }, async () => {
      while (!this.stopping && nextIndex < messages.length) {
        const message = messages[nextIndex];
        nextIndex += 1;
        if (message) await this.processMessage(message);
      }
    });
    await Promise.all(workers);

    if (this.stopping && nextIndex < messages.length) {
      await this.releaseUnstarted(messages.slice(nextIndex));
    }
  }

  private async processMessage(message: Message): Promise<void> {
    return observabilityContext.run(SqsWagerConsumer.contextFor(message), () =>
      this.processMessageWithContext(message),
    );
  }

  private async processMessageWithContext(message: Message): Promise<void> {
    if (!message.ReceiptHandle) {
      this.logger.error('SQS delivered a message without ReceiptHandle');
      return;
    }

    const startedAt = performance.now();
    try {
      const result = await this.processor.execute(
        message.Body,
        this.config.getOrThrow<string>('SQS_CONSUMER_NAME'),
      );
      const kind = SqsWagerConsumer.kindFor(message.Body);
      if (result.transaction && kind) {
        this.metrics?.recordWager(result.transaction.status, kind);
      }
      if (result.duplicate) this.metrics?.recordReplay('sqs');
      if (this.config.get<string>('FAULT_INJECT') === 'after_commit') {
        this.logger.fatal({
          event: 'fault_injected_after_commit',
          messageId: result.messageId,
          transactionId: result.transaction?.transactionId,
        });
        process.exit(1);
      }
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: await this.getQueueUrl(false),
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
      this.logger.log({
        event: 'wager_message_acknowledged',
        messageId: result.messageId,
        duplicate: result.duplicate,
        transactionId: result.transaction?.transactionId,
      });
    } catch (error) {
      await this.handleFailure(message, error);
    } finally {
      this.metrics?.observeWagerDuration(
        'sqs',
        (performance.now() - startedAt) / 1_000,
      );
    }
  }

  private async handleFailure(message: Message, error: unknown): Promise<void> {
    const kind = SqsWagerConsumer.classify(error);
    const receiveCount = Number(
      message.Attributes?.ApproximateReceiveCount ?? '1',
    );
    const maxReceiveCount = this.config.getOrThrow<number>(
      'SQS_MAX_RECEIVE_COUNT',
    );

    this.logger.warn({
      event: 'wager_message_failed',
      sqsMessageId: message.MessageId,
      receiveCount,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });

    if (receiveCount >= maxReceiveCount) {
      await this.deadLetter(message, kind, error);
      return;
    }

    this.metrics?.recordSqsRetry();

    const base = this.config.getOrThrow<number>('SQS_RETRY_BASE_SECONDS');
    const maximum = this.config.getOrThrow<number>('SQS_RETRY_MAX_SECONDS');
    const visibilityTimeout = Math.min(2 ** receiveCount * base, maximum);
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: await this.getQueueUrl(false),
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: visibilityTimeout,
      }),
    );
  }

  private async deadLetter(
    message: Message,
    kind: FailureKind,
    error: unknown,
  ): Promise<void> {
    if (!message.ReceiptHandle) return;
    const body = message.Body ?? '';
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: await this.getQueueUrl(true),
        MessageBody: body,
        MessageGroupId: message.Attributes?.MessageGroupId ?? 'invalid',
        MessageDeduplicationId: createHash('sha256')
          .update(`${message.MessageId ?? ''}:${body}`)
          .digest('hex'),
        MessageAttributes: {
          failureKind: { DataType: 'String', StringValue: kind },
          failureReason: {
            DataType: 'String',
            StringValue: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 256),
          },
        },
      }),
    );
    this.metrics?.recordSqsDlq();
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: await this.getQueueUrl(false),
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  private async releaseUnstarted(messages: Message[]): Promise<void> {
    const entries = messages.flatMap((message, index) =>
      message.ReceiptHandle
        ? [
            {
              Id: String(index),
              ReceiptHandle: message.ReceiptHandle,
              VisibilityTimeout: 0,
            },
          ]
        : [],
    );
    if (entries.length === 0) return;
    await this.client.send(
      new ChangeMessageVisibilityBatchCommand({
        QueueUrl: await this.getQueueUrl(false),
        Entries: entries,
      }),
    );
  }

  private async getQueueUrl(deadLetter: boolean): Promise<string> {
    const cached = deadLetter ? this.deadLetterQueueUrl : this.queueUrl;
    if (cached) return cached;
    const queueName = this.config.getOrThrow<string>(
      deadLetter ? 'SQS_DLQ_NAME' : 'SQS_QUEUE_NAME',
    );
    const result = await this.client.send(
      new GetQueueUrlCommand({ QueueName: queueName }),
    );
    if (!result.QueueUrl) {
      throw new Error(`SQS did not return a URL for ${queueName}`);
    }
    const discovered = new URL(result.QueueUrl);
    const configured = new URL(
      this.config.getOrThrow<string>('AWS_ENDPOINT_URL'),
    );
    configured.pathname = discovered.pathname;
    configured.search = discovered.search;
    const queueUrl = configured.toString();
    if (deadLetter) this.deadLetterQueueUrl = queueUrl;
    else this.queueUrl = queueUrl;
    return queueUrl;
  }

  private static classify(error: unknown): FailureKind {
    if (
      error instanceof InvalidWagerMessageError ||
      error instanceof InboxPayloadConflictError ||
      error instanceof IdempotencyConflictError ||
      error instanceof WagerTransactionConflictError
    ) {
      return 'permanent';
    }
    if (error instanceof TransientPersistenceError) return 'transient';
    return 'transient';
  }

  private static contextFor(message: Message): ObservabilityContext {
    const identifiers = this.identifiersFor(message.Body);
    return {
      correlationId: identifiers.messageId ?? message.MessageId ?? randomUUID(),
      messageId: identifiers.messageId ?? message.MessageId,
      walletId: identifiers.walletId,
      providerId: identifiers.providerId,
    };
  }

  private static kindFor(body: string | undefined): string | undefined {
    return this.identifiersFor(body).kind;
  }

  private static identifiersFor(body: string | undefined): {
    messageId?: string;
    walletId?: string;
    providerId?: string;
    kind?: string;
  } {
    if (!body) return {};
    try {
      const parsed = JSON.parse(body) as {
        messageId?: unknown;
        data?: {
          walletId?: unknown;
          providerId?: unknown;
          kind?: unknown;
        };
      };
      return {
        messageId:
          typeof parsed.messageId === 'string' ? parsed.messageId : undefined,
        walletId:
          typeof parsed.data?.walletId === 'string'
            ? parsed.data.walletId
            : undefined,
        providerId:
          typeof parsed.data?.providerId === 'string'
            ? parsed.data.providerId
            : undefined,
        kind:
          typeof parsed.data?.kind === 'string' ? parsed.data.kind : undefined,
      };
    } catch {
      return {};
    }
  }
}
