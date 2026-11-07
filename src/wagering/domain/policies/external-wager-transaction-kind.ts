import { InvalidExternalTransactionKindError } from '../errors/invalid-external-transaction-kind.error.js';
import {
  WagerTransactionKind,
  type WagerTransactionKind as WagerTransactionKindValue,
} from '../value-objects/wager-transaction-kind.js';

export type ExternalWagerTransactionKind = Exclude<
  WagerTransactionKindValue,
  typeof WagerTransactionKind.OPENING
>;

const EXTERNAL_KINDS = new Set<string>([
  WagerTransactionKind.BET,
  WagerTransactionKind.WIN,
  WagerTransactionKind.LOSS,
  WagerTransactionKind.REFUND,
  WagerTransactionKind.ROLLBACK,
]);

export function parseExternalWagerTransactionKind(
  value: string,
): ExternalWagerTransactionKind {
  if (!EXTERNAL_KINDS.has(value)) {
    throw new InvalidExternalTransactionKindError(value);
  }

  return value as ExternalWagerTransactionKind;
}
