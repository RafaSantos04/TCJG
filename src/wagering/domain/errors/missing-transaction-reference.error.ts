import type { WagerTransactionKind } from '../value-objects/wager-transaction-kind.js';

export class MissingTransactionReferenceError extends Error {
  override readonly name = 'MissingTransactionReferenceError';

  constructor(readonly kind: WagerTransactionKind) {
    super(`${kind} requires a referenced transaction`);
  }
}
