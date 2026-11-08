import * as z from 'zod';

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (value) =>
          ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
        'DATABASE_URL must use the postgres or postgresql protocol',
      )
      .default('postgresql://tcjg:tcjg@localhost:5433/tcjg'),
    DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    AWS_REGION: z.string().min(1).default('us-east-1'),
    AWS_ENDPOINT_URL: z.string().url().default('http://localhost:4566'),
    AWS_ACCESS_KEY_ID: z.string().min(1).default('test'),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).default('test'),
    OUTBOX_QUEUE_NAME: z.string().min(1).default('wallet-events.fifo'),
    OUTBOX_WORKER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
    OUTBOX_LEASE_MS: z.coerce.number().int().positive().default(30_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    OUTBOX_RETRY_BASE_MS: z.coerce.number().int().positive().default(1_000),
    OUTBOX_RETRY_MAX_MS: z.coerce.number().int().positive().default(60_000),
    OUTBOX_RETRY_JITTER: z.coerce.number().min(0).max(1).default(0.2),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  })
  .superRefine((environment, context) => {
    if (environment.DB_POOL_MIN > environment.DB_POOL_MAX) {
      context.addIssue({
        code: 'custom',
        message: 'DB_POOL_MAX must be greater than or equal to DB_POOL_MIN',
        path: ['DB_POOL_MAX'],
      });
    }
    if (environment.OUTBOX_RETRY_BASE_MS > environment.OUTBOX_RETRY_MAX_MS) {
      context.addIssue({
        code: 'custom',
        message:
          'OUTBOX_RETRY_MAX_MS must be greater than or equal to OUTBOX_RETRY_BASE_MS',
        path: ['OUTBOX_RETRY_MAX_MS'],
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;
