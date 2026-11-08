import { environmentSchema } from './environment.schema.js';

describe('environmentSchema', () => {
  it('provides safe local defaults and coerces numeric values', () => {
    const environment = environmentSchema.parse({ PORT: '4000' });

    expect(environment).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      DB_POOL_MIN: 2,
      DB_POOL_MAX: 10,
      AWS_REGION: 'us-east-1',
      OUTBOX_QUEUE_NAME: 'wallet-events.fifo',
      OUTBOX_WORKER_ENABLED: true,
      OUTBOX_BATCH_SIZE: 50,
      SQS_QUEUE_NAME: 'wager-transactions.fifo',
      SQS_DLQ_NAME: 'wager-transactions-dlq.fifo',
      SQS_CONSUMER_ENABLED: false,
      SQS_MAX_NUMBER_OF_MESSAGES: 10,
    });
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    const result = environmentSchema.safeParse({
      DATABASE_URL: 'mysql://user:password@localhost:3306/tcjg',
    });

    expect(result.success).toBe(false);
  });

  it('rejects ports outside the TCP range', () => {
    const result = environmentSchema.safeParse({ PORT: '70000' });

    expect(result.success).toBe(false);
  });

  it('rejects an inverted database pool range', () => {
    const result = environmentSchema.safeParse({
      DB_POOL_MIN: '10',
      DB_POOL_MAX: '2',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an inverted outbox retry range', () => {
    const result = environmentSchema.safeParse({
      OUTBOX_RETRY_BASE_MS: '2000',
      OUTBOX_RETRY_MAX_MS: '1000',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an inverted SQS retry range', () => {
    const result = environmentSchema.safeParse({
      SQS_RETRY_BASE_SECONDS: '10',
      SQS_RETRY_MAX_SECONDS: '5',
    });

    expect(result.success).toBe(false);
  });
});
