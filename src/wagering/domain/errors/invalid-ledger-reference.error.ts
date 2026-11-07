import type { WagerTransactionKind } from '../value-objects/wager-transaction-kind.js';

export class InvalidLedgerReferenceError extends Error {
  override readonly name = 'InvalidLedgerReferenceError';

  constructor(readonly referenceKind: WagerTransactionKind | undefined) {
    super(
      referenceKind === undefined
        ? 'ROLLBACK requires the referenced transaction to determine ledger direction'
        : `ROLLBACK cannot reference a ${referenceKind} transaction`,
    );
  }
}
