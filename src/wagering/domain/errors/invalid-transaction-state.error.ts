import type { WagerTransactionStatus } from '../value-objects/wager-transaction-status.js';

export class InvalidTransactionStateError extends Error {
  override readonly name = 'InvalidTransactionStateError';

  constructor(
    readonly currentStatus: WagerTransactionStatus,
    readonly attemptedStatus: WagerTransactionStatus,
  ) {
    super(
      `Cannot transition wager transaction from ${currentStatus} to ${attemptedStatus}`,
    );
  }
}
