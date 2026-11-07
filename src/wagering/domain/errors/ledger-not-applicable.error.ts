import type { WagerTransactionKind } from '../value-objects/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../value-objects/wager-transaction-status.js';

export class LedgerNotApplicableError extends Error {
  override readonly name = 'LedgerNotApplicableError';

  constructor(
    readonly kind: WagerTransactionKind,
    readonly status: WagerTransactionStatus,
  ) {
    super(
      `Transaction ${kind} in status ${status} does not produce a ledger entry`,
    );
  }
}
