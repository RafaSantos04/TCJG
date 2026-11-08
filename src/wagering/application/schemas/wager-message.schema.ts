import * as z from 'zod';

const positiveMoneySchema = z.strictObject({
  amount: z
    .string()
    .regex(/^(0|[1-9]\d*)\.\d{2}$/)
    .refine((amount) => amount !== '0.00', {
      message: 'Transaction money must be greater than zero',
    }),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const wagerMessageDataSchema = z.strictObject({
  providerId: z.string().trim().min(1).max(255),
  externalTransactionId: z.string().trim().min(1).max(255),
  idempotencyKey: z
    .string()
    .min(1)
    .max(512)
    .refine((value) => value.trim() === value, {
      message: 'idempotencyKey cannot have surrounding whitespace',
    }),
  playerId: z.uuid(),
  walletId: z.uuid(),
  roundId: z.string().trim().min(1).max(255),
  gameId: z.string().trim().min(1).max(255),
  kind: z.enum(['BET', 'WIN', 'LOSS']),
  money: positiveMoneySchema,
});

export const wagerMessageEnvelopeSchema = z.strictObject({
  messageId: z.string().trim().min(1).max(255),
  type: z.literal('WagerTransactionRequested'),
  occurredAt: z.iso.datetime(),
  data: wagerMessageDataSchema,
});

export type WagerMessageEnvelope = z.infer<typeof wagerMessageEnvelopeSchema>;
