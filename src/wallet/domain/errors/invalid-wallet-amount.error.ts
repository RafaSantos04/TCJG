import type { Money } from '../../../shared/domain/value-objects/money.js';

export class InvalidWalletAmountError extends Error {
  override readonly name = 'InvalidWalletAmountError';

  constructor(readonly amount: Money) {
    super(
      `Wallet operations require a positive amount, received ${amount.toString()}`,
    );
  }
}
