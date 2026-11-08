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
});
