import type { Money } from '../../../shared/domain/value-objects/money.js';

export class InsufficientFundsError extends Error {
  override readonly name = 'InsufficientFundsError';

  constructor(
    readonly availableBalance: Money,
    readonly requestedAmount: Money,
  ) {
    super(
      `Insufficient funds: available ${availableBalance.toString()}, requested ${requestedAmount.toString()}`,
    );
  }
}
