import { z } from 'zod';

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
  })
  .superRefine((environment, context) => {
    if (environment.DB_POOL_MIN > environment.DB_POOL_MAX) {
      context.addIssue({
        code: 'custom',
        message: 'DB_POOL_MAX must be greater than or equal to DB_POOL_MIN',
        path: ['DB_POOL_MAX'],
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;
