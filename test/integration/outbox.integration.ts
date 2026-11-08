import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SqsIntegrationEventPublisher } from '../../src/infrastructure/messaging/sqs-integration-event.publisher.js';
import { OutboxMessageEntity } from '../../src/infrastructure/persistence/mikro-orm/entities/outbox-message.entity.js';
import { Migration20261107160000InitialFinancialSchema } from '../../src/infrastructure/persistence/mikro-orm/migrations/Migration20261107160000InitialFinancialSchema.js';
import { MikroOrmOutboxRepository } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm-outbox.repository.js';
import { financialEntities } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm.options.js';
import { OutboxPublisherService } from '../../src/shared/application/services/outbox-publisher.service.js';
import { OutboxMessage } from '../../src/shared/domain/entities/outbox-message.js';
import { WalletBalanceChanged } from '../../src/shared/domain/events/financial-integration-events.js';

describe.sequential(
  'transactional outbox with PostgreSQL and LocalStack',
  () => {
    const schema = `phase_nine_${randomUUID().replaceAll('-', '')}`;
    const queueName = `${schema}.fifo`;
    const awsEndpoint = process.env.AWS_ENDPOINT_URL ?? 'http://127.0.0.1:4566';
    const awsRegion = process.env.AWS_REGION ?? 'us-east-1';
    const awsCredentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    };
    const sqs = new SQSClient({
      endpoint: awsEndpoint,
      region: awsRegion,
      credentials: awsCredentials,
      maxAttempts: 1,
    });
    let orm: Awaited<ReturnType<typeof MikroORM.init>>;
    let queueUrl: string;
    let repository: MikroOrmOutboxRepository;
    let publisher: SqsIntegrationEventPublisher;
    let service: OutboxPublisherService;

    const configValues = {
      AWS_ENDPOINT_URL: awsEndpoint,
      AWS_REGION: awsRegion,
      AWS_ACCESS_KEY_ID: awsCredentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: awsCredentials.secretAccessKey,
      OUTBOX_QUEUE_NAME: queueName,
      OUTBOX_BATCH_SIZE: 4,
      OUTBOX_LEASE_MS: 30_000,
      OUTBOX_RETRY_BASE_MS: 10,
      OUTBOX_RETRY_MAX_MS: 100,
      OUTBOX_RETRY_JITTER: 0,
      OUTBOX_MAX_ATTEMPTS: 3,
    };

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

      const queue = await sqs.send(
        new CreateQueueCommand({
          QueueName: queueName,
          Attributes: {
            FifoQueue: 'true',
            ContentBasedDeduplication: 'true',
          },
        }),
      );
      if (!queue.QueueUrl)
        throw new Error('LocalStack did not return QueueUrl');
      const discoveredQueueUrl = new URL(queue.QueueUrl);
      const configuredEndpoint = new URL(awsEndpoint);
      configuredEndpoint.pathname = discoveredQueueUrl.pathname;
      queueUrl = configuredEndpoint.toString();

      repository = new MikroOrmOutboxRepository(orm.em);
      const config = new ConfigService(configValues);
      publisher = new SqsIntegrationEventPublisher(config);
      service = new OutboxPublisherService(repository, publisher, config);
    }, 60_000);

    beforeEach(async () => {
      await orm.em
        .getConnection()
        .execute(`delete from "${schema}".outbox_messages`);
    });

    afterAll(async () => {
      publisher?.onApplicationShutdown();
      if (queueUrl) {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
      }
      sqs.destroy();
      if (orm) {
        await orm.em
          .getConnection()
          .execute(`drop schema if exists "${schema}" cascade`);
        await orm.close(true);
      }
    });

    it('lets another publisher recover a lease abandoned after commit', async () => {
      const message = await insertMessage();

      const abandoned = await repository.claimBatch(1, 30_000);
      expect(abandoned.map((claim) => claim.message.id)).toEqual([message.id]);
      await orm.em
        .getConnection()
        .execute(
          `update "${schema}".outbox_messages set next_attempt_at = now() where id = ?`,
          [message.id],
        );

      expect((await service.runOnce()).published).toBe(1);
      expect(await publishedCount()).toBe(1);
      expect(await receiveAndDelete(1)).toBe(1);
    });

    it('allows two publishers to drain the same outbox concurrently', async () => {
      await Promise.all(Array.from({ length: 8 }, () => insertMessage()));

      const [first, second] = await Promise.all([
        service.runOnce(),
        service.runOnce(),
      ]);

      expect(first.published + second.published).toBe(8);
      expect(await publishedCount()).toBe(8);
      expect(await receiveAndDelete(8)).toBe(8);
    });

    it('does not overtake an older pending event from the same aggregate', async () => {
      const aggregateId = randomUUID();
      const occurredAt = new Date();
      const first = await insertMessage(occurredAt, aggregateId);
      const second = await insertMessage(
        new Date(occurredAt.getTime() + 1),
        aggregateId,
      );

      expect((await service.runOnce()).published).toBe(1);
      const rowsAfterFirst = await orm.em
        .getConnection()
        .execute<Array<{ id: string; published_at: Date | null }>>(
          `select id, published_at from "${schema}".outbox_messages order by occurred_at, id`,
        );
      expect(rowsAfterFirst).toEqual([
        { id: first.id, published_at: expect.any(Date) },
        { id: second.id, published_at: null },
      ]);

      expect((await service.runOnce()).published).toBe(1);
      expect(await receiveAndDelete(2)).toBe(2);
    });

    it('schedules retry while SQS is unavailable and publishes later', async () => {
      const message = await insertMessage();
      const unavailableConfig = new ConfigService({
        ...configValues,
        AWS_ENDPOINT_URL: 'http://127.0.0.1:1',
      });
      const unavailablePublisher = new SqsIntegrationEventPublisher(
        unavailableConfig,
      );
      const unavailableService = new OutboxPublisherService(
        repository,
        unavailablePublisher,
        unavailableConfig,
      );

      expect((await unavailableService.runOnce()).retried).toBe(1);
      unavailablePublisher.onApplicationShutdown();
      const [retried] = await orm.em
        .getConnection()
        .execute<Array<{ attempts: number; published_at: Date | null }>>(
          `select attempts, published_at from "${schema}".outbox_messages where id = ?`,
          [message.id],
        );
      expect(retried).toMatchObject({ attempts: 1, published_at: null });

      await orm.em
        .getConnection()
        .execute(
          `update "${schema}".outbox_messages set next_attempt_at = now() where id = ?`,
          [message.id],
        );
      expect((await service.runOnce()).published).toBe(1);
      expect(await receiveAndDelete(1)).toBe(1);
    });

    it('reports outbox lag from the oldest pending event', async () => {
      await insertMessage(new Date(Date.now() - 5_000));

      expect(await service.getLagSeconds()).toBeGreaterThanOrEqual(4);
    });

    async function insertMessage(
      occurredAt = new Date(),
      walletId = randomUUID(),
    ): Promise<OutboxMessage> {
      const message = OutboxMessage.enqueue(
        WalletBalanceChanged.create({
          aggregateId: walletId,
          correlationId: randomUUID(),
          occurredAt,
          data: {
            walletId,
            transactionId: randomUUID(),
            direction: 'CREDIT',
            money: { amount: '1.00', currency: 'BRL' },
            balanceBefore: { amount: '0.00', currency: 'BRL' },
            balanceAfter: { amount: '1.00', currency: 'BRL' },
            walletVersion: 1,
          },
        }),
      );
      const entity = new OutboxMessageEntity();
      entity.id = message.id;
      entity.aggregateId = message.aggregateId;
      entity.eventType = message.eventType;
      entity.payload = message.payload as Record<string, unknown>;
      entity.occurredAt = message.occurredAt;
      entity.attempts = message.attempts;
      entity.nextAttemptAt = message.nextAttemptAt;
      await orm.em.fork().insert(OutboxMessageEntity, entity);
      return message;
    }

    async function publishedCount(): Promise<number> {
      const [row] = await orm.em
        .getConnection()
        .execute<Array<{ count: string }>>(
          `select count(*)::text as count from "${schema}".outbox_messages where published_at is not null`,
        );
      return Number(row?.count ?? 0);
    }

    async function receiveAndDelete(expected: number): Promise<number> {
      const deadline = Date.now() + 10_000;
      let received = 0;
      while (received < expected && Date.now() < deadline) {
        const response = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 1,
            AttributeNames: ['All'],
          }),
        );
        for (const item of response.Messages ?? []) {
          expect(item.Attributes?.MessageDeduplicationId).toBeTruthy();
          expect(item.Attributes?.MessageGroupId).toBeTruthy();
          received += 1;
          if (item.ReceiptHandle) {
            await sqs.send(
              new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: item.ReceiptHandle,
              }),
            );
          }
        }
      }
      return received;
    }
  },
);
