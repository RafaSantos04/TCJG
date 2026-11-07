import { InvalidLedgerEntryError } from '../errors/invalid-ledger-entry.error.js';
import type { Money } from '../../../shared/domain/value-objects/money.js';

export const WalletLedgerDirection = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;

export type WalletLedgerDirection =
  (typeof WalletLedgerDirection)[keyof typeof WalletLedgerDirection];

export type CreateWalletLedgerEntry = Readonly<{
  walletId: string;
  transactionId: string;
  direction: WalletLedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}>;

export class WalletLedgerEntry {
  private readonly createdAtValue: Date;

  private constructor(
    readonly walletId: string,
    readonly transactionId: string,
    readonly direction: WalletLedgerDirection,
    readonly money: Money,
    readonly balanceBefore: Money,
    readonly balanceAfter: Money,
    createdAt: Date,
  ) {
    this.createdAtValue = new Date(createdAt.getTime());
    Object.freeze(this);
  }

  static create(input: CreateWalletLedgerEntry): WalletLedgerEntry {
    if (!input.money.isPositive()) {
      throw new InvalidLedgerEntryError(
        'Ledger entries require a positive amount',
      );
    }

    if (input.balanceBefore.isNegative() || input.balanceAfter.isNegative()) {
      throw new InvalidLedgerEntryError('Ledger balances cannot be negative');
    }

    const entry = new WalletLedgerEntry(
      input.walletId,
      input.transactionId,
      input.direction,
      input.money,
      input.balanceBefore,
      input.balanceAfter,
      input.createdAt,
    );

    if (!entry.isBalanced()) {
      throw new InvalidLedgerEntryError(
        'Ledger entry arithmetic does not match its direction',
      );
    }

    return entry;
  }

  get createdAt(): Date {
    return new Date(this.createdAtValue.getTime());
  }

  isBalanced(): boolean {
    const expectedBalance =
      this.direction === WalletLedgerDirection.CREDIT
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);

    return expectedBalance.equals(this.balanceAfter);
  }
}
