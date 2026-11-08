import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SqsWagerConsumer } from '../../src/infrastructure/messaging/sqs-wager-consumer.js';
import { Migration20261107160000InitialFinancialSchema } from '../../src/infrastructure/persistence/mikro-orm/migrations/Migration20261107160000InitialFinancialSchema.js';
import { MikroOrmFinancialTransactionAdapter } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm-financial-transaction.adapter.js';
import { financialEntities } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm.options.js';
import { TransientPersistenceError } from '../../src/shared/application/errors/persistence.error.js';
import { CreateWallet } from '../../src/wallet/application/create-wallet.js';
import { ProcessWagerMessage } from '../../src/wagering/application/process-wager-message.js';
import { ProcessWagerTransaction } from '../../src/wagering/application/process-wager-transaction.js';

type QueuePair = Readonly<{
  queueName: string;
  queueUrl: string;
  dlqName: string;
  dlqUrl: string;
}>;

describe.sequential('SQS consumer and transactional inbox', () => {
  const schema = `phase_ten_${randomUUID().replaceAll('-', '')}`;
  const awsEndpoint = process.env.AWS_ENDPOINT_URL ?? 'http://127.0.0.1:4566';
  const awsRegion = process.env.AWS_REGION ?? 'us-east-1';
  const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  };
  const sqs = new SQSClient({
    endpoint: awsEndpoint,
    region: awsRegion,
    credentials,
    maxAttempts: 1,
  });
  const queues: QueuePair[] = [];
  let orm: Awaited<ReturnType<typeof MikroORM.init>>;
  let adapter: MikroOrmFinancialTransactionAdapter;
  let createWallet: CreateWallet;
  let processor: ProcessWagerMessage;

  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      clientUrl:
        process.env.TEST_DATABASE_URL ??
        'postgresql://tcjg:tcjg@127.0.0.1:5433/tcjg',
      schema,
      entities: financialEntities,
      metadataProvider: ReflectMetadataProvider,
      extensions: [Migrator],
      migrations: {
        migrationsList: [Migration20261107160000InitialFinancialSchema],
        tableName: 'mikro_orm_migrations',
        transactional: true,
        allOrNothing: true,
      },
    });
    await orm.migrator.up({ schema });
    adapter = new MikroOrmFinancialTransactionAdapter(orm.em);
    createWallet = new CreateWallet(adapter);
    processor = new ProcessWagerMessage(
      adapter,
      new ProcessWagerTransaction(adapter),
    );
  }, 60_000);

  beforeEach(async () => {
    await orm.em.getConnection().execute(`
      truncate table
        "${schema}"."outbox_messages",
        "${schema}"."inbox_messages",
        "${schema}"."wallet_ledger_entries",
        "${schema}"."wager_transactions",
        "${schema}"."wallets"
      restart identity cascade
    `);
  });

  afterAll(async () => {
    for (const queue of queues) {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queue.queueUrl }));
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queue.dlqUrl }));
    }
    sqs.destroy();
    if (orm) {
      await orm.em
        .getConnection()
        .execute(`drop schema if exists "${schema}" cascade`);
      await orm.close(true);
    }
  });

  it('deduplicates redelivery, including commit before ack', async () => {
    const pair = await createQueuePair('redelivery');
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const body = wagerBody(wallet.id, wallet.playerId, 'redelivery');

    const first = await processor.execute(body, 'phase-ten-consumer');
    expect(first.duplicate).toBe(false);

    await send(pair.queueUrl, body, wallet.id);
    const consumer = makeConsumer(pair, processor);
    expect(await pollConsumer(consumer)).toBe(true);
    await consumer.onApplicationShutdown();

    const counts = await tableCounts();
    expect(counts).toEqual({ inbox: 1, wagers: 2, ledger: 2 });
  });

  it('retries a transient error and succeeds without duplicate effects', async () => {
    const pair = await createQueuePair('retry');
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const body = wagerBody(wallet.id, wallet.playerId, 'retry');
    let attempts = 0;
    const flakyProcessor = {
      execute: async (rawBody: string | undefined, consumerName: string) => {
        attempts += 1;
        if (attempts === 1) {
          throw new TransientPersistenceError('temporary database outage');
        }
        return processor.execute(rawBody, consumerName);
      },
    } as ProcessWagerMessage;
    const consumer = makeConsumer(pair, flakyProcessor, {
      SQS_RETRY_BASE_SECONDS: 0,
    });

    await send(pair.queueUrl, body, wallet.id);
    expect(await pollConsumer(consumer)).toBe(true);
    expect(await pollUntil(async () => (await consumer.runOnce()) > 0)).toBe(
      true,
    );
    await consumer.onApplicationShutdown();

    expect(attempts).toBe(2);
    expect(await tableCounts()).toEqual({ inbox: 1, wagers: 2, ledger: 2 });
  });

  it('moves a poison message to the DLQ at the receive limit', async () => {
    const pair = await createQueuePair('poison');
    const consumer = makeConsumer(pair, processor, {
      SQS_MAX_RECEIVE_COUNT: 2,
      SQS_RETRY_BASE_SECONDS: 0,
    });
    await send(pair.queueUrl, '{invalid-json', randomUUID());

    expect(await pollConsumer(consumer)).toBe(true);
    expect(await pollUntil(async () => (await consumer.runOnce()) > 0)).toBe(
      true,
    );
    await consumer.onApplicationShutdown();

    const dlqMessage = await pollUntil(async () => {
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: pair.dlqUrl,
          WaitTimeSeconds: 0,
          MaxNumberOfMessages: 1,
          MessageAttributeNames: ['All'],
        }),
      );
      return result.Messages?.[0];
    });
    if (!dlqMessage) throw new Error('Poison message did not reach the DLQ');
    expect(dlqMessage?.Body).toBe('{invalid-json');
    expect(dlqMessage?.MessageAttributes?.failureKind?.StringValue).toBe(
      'permanent',
    );
  });

  it('finishes in-flight work and releases unstarted messages on shutdown', async () => {
    const pair = await createQueuePair('shutdown');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    const slowProcessor = {
      execute: async () => {
        started = true;
        await gate;
        return { messageId: randomUUID(), duplicate: false };
      },
    } as unknown as ProcessWagerMessage;
    const consumer = makeConsumer(pair, slowProcessor, {
      SQS_CONSUMER_ENABLED: true,
      SQS_CONSUMER_CONCURRENCY: 1,
    });
    await Promise.all(
      [1, 2, 3].map((index) =>
        send(pair.queueUrl, JSON.stringify({ index }), randomUUID()),
      ),
    );

    consumer.onApplicationBootstrap();
    expect(await pollUntil(async () => started)).toBe(true);
    const shutdown = consumer.onApplicationShutdown();
    release();
    await shutdown;

    const visible = await pollUntil(async () => {
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: pair.queueUrl,
          WaitTimeSeconds: 0,
          MaxNumberOfMessages: 10,
        }),
      );
      return result.Messages && result.Messages.length >= 2
        ? result.Messages
        : undefined;
    });
    expect(visible).toHaveLength(2);
  });

  async function createQueuePair(label: string): Promise<QueuePair> {
    const suffix = `${schema}_${label}_${randomUUID().slice(0, 8)}`;
    const dlqName = `${suffix}_dlq.fifo`;
    const dlq = await sqs.send(
      new CreateQueueCommand({
        QueueName: dlqName,
        Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' },
      }),
    );
    if (!dlq.QueueUrl) throw new Error('LocalStack did not return DLQ URL');
    const attributes = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: dlq.QueueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
    const dlqArn = attributes.Attributes?.QueueArn;
    if (!dlqArn) throw new Error('LocalStack did not return DLQ ARN');
    const queueName = `${suffix}.fifo`;
    const queue = await sqs.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlqArn,
            maxReceiveCount: '2',
          }),
        },
      }),
    );
    if (!queue.QueueUrl) throw new Error('LocalStack did not return queue URL');
    const pair = {
      queueName,
      queueUrl: endpointUrl(queue.QueueUrl),
      dlqName,
      dlqUrl: endpointUrl(dlq.QueueUrl),
    };
    queues.push(pair);
    return pair;
  }

  function makeConsumer(
    pair: QueuePair,
    messageProcessor: ProcessWagerMessage,
    overrides: Record<string, unknown> = {},
  ): SqsWagerConsumer {
    return new SqsWagerConsumer(
      messageProcessor,
      new ConfigService({
        AWS_ENDPOINT_URL: awsEndpoint,
        AWS_REGION: awsRegion,
        AWS_ACCESS_KEY_ID: credentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        SQS_QUEUE_NAME: pair.queueName,
        SQS_DLQ_NAME: pair.dlqName,
        SQS_CONSUMER_NAME: 'phase-ten-consumer',
        SQS_CONSUMER_ENABLED: false,
        SQS_WAIT_TIME_SECONDS: 0,
        SQS_MAX_NUMBER_OF_MESSAGES: 10,
        SQS_CONSUMER_CONCURRENCY: 10,
        SQS_VISIBILITY_TIMEOUT_SECONDS: 5,
        SQS_MAX_RECEIVE_COUNT: 5,
        SQS_RETRY_BASE_SECONDS: 1,
        SQS_RETRY_MAX_SECONDS: 5,
        ...overrides,
      }),
    );
  }

  function wagerBody(
    walletId: string,
    playerId: string,
    label: string,
  ): string {
    return JSON.stringify({
      messageId: `message-${label}`,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-a',
        externalTransactionId: `external-${label}`,
        idempotencyKey: `provider-a:external-${label}`,
        playerId,
        walletId,
        roundId: `round-${label}`,
        gameId: 'fortune-chimp',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      },
    });
  }

  async function send(
    queueUrl: string,
    body: string,
    groupId: string,
  ): Promise<void> {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
        MessageGroupId: groupId,
        MessageDeduplicationId: randomUUID(),
      }),
    );
  }

  async function pollConsumer(consumer: SqsWagerConsumer): Promise<boolean> {
    return pollUntil(async () => (await consumer.runOnce()) > 0);
  }

  async function pollUntil<T>(
    probe: () => Promise<T>,
    timeoutMs = 5_000,
  ): Promise<T | false> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await probe();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  }

  async function tableCounts(): Promise<{
    inbox: number;
    wagers: number;
    ledger: number;
  }> {
    const [row] = await orm.em.getConnection().execute<
      Array<{ inbox: string; wagers: string; ledger: string }>
    >(`
      select
        (select count(*) from "${schema}"."inbox_messages") as inbox,
        (select count(*) from "${schema}"."wager_transactions") as wagers,
        (select count(*) from "${schema}"."wallet_ledger_entries") as ledger
    `);
    if (!row) throw new Error('Count query returned no row');
    return {
      inbox: Number(row.inbox),
      wagers: Number(row.wagers),
      ledger: Number(row.ledger),
    };
  }

  function endpointUrl(discoveredUrl: string): string {
    const discovered = new URL(discoveredUrl);
    const endpoint = new URL(awsEndpoint);
    endpoint.pathname = discovered.pathname;
    endpoint.search = discovered.search;
    return endpoint.toString();
  }
});
