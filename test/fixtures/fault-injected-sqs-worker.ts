import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { SqsWagerConsumer } from '../../src/infrastructure/messaging/sqs-wager-consumer.js';
import { MikroOrmFinancialTransactionAdapter } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm-financial-transaction.adapter.js';
import { financialEntities } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm.options.js';
import { ProcessWagerMessage } from '../../src/wagering/application/process-wager-message.js';
import { ProcessWagerTransaction } from '../../src/wagering/application/process-wager-transaction.js';

const schema = requiredEnvironment('TEST_SCHEMA');
const orm = await MikroORM.init({
  driver: PostgreSqlDriver,
  clientUrl: requiredEnvironment('TEST_DATABASE_URL'),
  schema,
  entities: financialEntities,
  metadataProvider: ReflectMetadataProvider,
  pool: { min: 1, max: 2 },
});
const adapter = new MikroOrmFinancialTransactionAdapter(orm.em);
const processor = new ProcessWagerMessage(
  adapter,
  new ProcessWagerTransaction(adapter),
);
const consumer = new SqsWagerConsumer(
  processor,
  new ConfigService({
    AWS_ENDPOINT_URL: requiredEnvironment('AWS_ENDPOINT_URL'),
    AWS_REGION: requiredEnvironment('AWS_REGION'),
    AWS_ACCESS_KEY_ID: requiredEnvironment('AWS_ACCESS_KEY_ID'),
    AWS_SECRET_ACCESS_KEY: requiredEnvironment('AWS_SECRET_ACCESS_KEY'),
    SQS_QUEUE_NAME: requiredEnvironment('SQS_QUEUE_NAME'),
    SQS_DLQ_NAME: requiredEnvironment('SQS_DLQ_NAME'),
    SQS_CONSUMER_NAME: 'phase-fourteen-fault-worker',
    SQS_CONSUMER_ENABLED: false,
    SQS_WAIT_TIME_SECONDS: 1,
    SQS_MAX_NUMBER_OF_MESSAGES: 1,
    SQS_CONSUMER_CONCURRENCY: 1,
    SQS_VISIBILITY_TIMEOUT_SECONDS: 1,
    SQS_MAX_RECEIVE_COUNT: 5,
    SQS_RETRY_BASE_SECONDS: 1,
    SQS_RETRY_MAX_SECONDS: 5,
    FAULT_INJECT: 'after_commit',
  }),
);

await consumer.runOnce();
await consumer.onApplicationShutdown();
await orm.close(true);
throw new Error('The fault-injected worker did not terminate after commit');

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
