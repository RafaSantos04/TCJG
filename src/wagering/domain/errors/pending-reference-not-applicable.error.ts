import type { WagerTransactionKind } from '../value-objects/wager-transaction-kind.js';

export class PendingReferenceNotApplicableError extends Error {
  override readonly name = 'PendingReferenceNotApplicableError';

  constructor(readonly kind: WagerTransactionKind) {
    super(`${kind} cannot wait for a referenced transaction`);
  }
}
