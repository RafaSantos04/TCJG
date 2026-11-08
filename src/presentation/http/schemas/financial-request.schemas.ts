import { z } from 'zod';

const moneySchema = z.strictObject({
  amount: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const positiveMoneySchema = moneySchema.refine(
  (money) => money.amount !== '0.00',
  { message: 'Transaction money must be greater than zero' },
);

export const createWalletRequestSchema = z.strictObject({
  playerId: z.uuid(),
  initialBalance: moneySchema,
});

export type CreateWalletRequest = z.infer<typeof createWalletRequestSchema>;

export const processWagerTransactionRequestSchema = z
  .strictObject({
    providerId: z.string().trim().min(1).max(255),
    externalTransactionId: z.string().trim().min(1).max(255),
    playerId: z.uuid(),
    walletId: z.uuid(),
    roundId: z.string().trim().min(1).max(255),
    gameId: z.string().trim().min(1).max(255),
    kind: z.enum(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']),
    money: positiveMoneySchema,
    referenceExternalTransactionId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional(),
  })
  .superRefine((request, context) => {
    if (
      ['REFUND', 'ROLLBACK'].includes(request.kind) &&
      !request.referenceExternalTransactionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['referenceExternalTransactionId'],
        message: `${request.kind} requires referenceExternalTransactionId`,
      });
    }
  });

export type ProcessWagerTransactionRequest = z.infer<
  typeof processWagerTransactionRequestSchema
>;

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim() === value, {
    message: 'Idempotency-Key cannot have surrounding whitespace',
  });

export const uuidPathSchema = z.uuid();

export const providerIdPathSchema = z.string().trim().min(1).max(255);

export const externalTransactionIdPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(255);

export const ledgerQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
