import { Money } from '../../../shared/domain/value-objects/money.js';
import { InsufficientFundsError } from '../errors/insufficient-funds.error.js';
import { InvalidWalletAmountError } from '../errors/invalid-wallet-amount.error.js';
import {
  WalletLedgerDirection,
  WalletLedgerEntry,
} from '../entities/wallet-ledger-entry.js';

export type OpenWallet = Readonly<{
  id: string;
  playerId: string;
  currency: string;
  at: Date;
}>;

export type OpenWalletWithInitialBalance = Omit<OpenWallet, 'currency'> &
  Readonly<{
    initialBalance: Money;
    openingTransactionId: string;
  }>;

export type OpenedWalletWithLedger = Readonly<{
  wallet: Wallet;
  ledgerEntry: WalletLedgerEntry;
}>;

export type RehydrateWallet = Readonly<{
  id: string;
  playerId: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export class Wallet {
  private balanceValue: Money;
  private versionValue: number;
  private readonly createdAtValue: Date;
  private updatedAtValue: Date;

  private constructor(
    readonly id: string,
    readonly playerId: string,
    balance: Money,
    version: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    this.balanceValue = balance;
    this.versionValue = version;
    this.createdAtValue = new Date(createdAt.getTime());
    this.updatedAtValue = new Date(updatedAt.getTime());
  }

  static open(input: OpenWallet): Wallet {
    const openedAt = new Date(input.at.getTime());

    return new Wallet(
      input.id,
      input.playerId,
      Money.zero(input.currency),
      1,
      openedAt,
      openedAt,
    );
  }

  static openWithInitialBalance(
    input: OpenWalletWithInitialBalance,
  ): OpenedWalletWithLedger {
    if (!input.initialBalance.isPositive()) {
      throw new InvalidWalletAmountError(input.initialBalance);
    }

    const openedAt = new Date(input.at.getTime());
    const balanceBefore = Money.zero(input.initialBalance.currency);
    const wallet = new Wallet(
      input.id,
      input.playerId,
      input.initialBalance,
      1,
      openedAt,
      openedAt,
    );
    const ledgerEntry = WalletLedgerEntry.create({
      walletId: input.id,
      transactionId: input.openingTransactionId,
      direction: WalletLedgerDirection.CREDIT,
      money: input.initialBalance,
      balanceBefore,
      balanceAfter: input.initialBalance,
      createdAt: openedAt,
    });

    return Object.freeze({ wallet, ledgerEntry });
  }

  static rehydrate(input: RehydrateWallet): Wallet {
    return new Wallet(
      input.id,
      input.playerId,
      input.balance,
      input.version,
      input.createdAt,
      input.updatedAt,
    );
  }

  get balance(): Money {
    return this.balanceValue;
  }

  get currency(): string {
    return this.balanceValue.currency;
  }

  get version(): number {
    return this.versionValue;
  }

  get createdAt(): Date {
    return new Date(this.createdAtValue.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.updatedAtValue.getTime());
  }

  debit(money: Money, transactionId: string, at: Date): WalletLedgerEntry {
    this.assertValidOperationAmount(money);

    if (this.balanceValue.isLessThan(money)) {
      throw new InsufficientFundsError(this.balanceValue, money);
    }

    const balanceBefore = this.balanceValue;
    const balanceAfter = balanceBefore.subtract(money);
    const entry = WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction: WalletLedgerDirection.DEBIT,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: at,
    });

    this.applyBalanceChange(balanceAfter, at);

    return entry;
  }

  credit(money: Money, transactionId: string, at: Date): WalletLedgerEntry {
    this.assertValidOperationAmount(money);

    const balanceBefore = this.balanceValue;
    const balanceAfter = balanceBefore.add(money);
    const entry = WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction: WalletLedgerDirection.CREDIT,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: at,
    });

    this.applyBalanceChange(balanceAfter, at);

    return entry;
  }

  private assertValidOperationAmount(money: Money): void {
    this.balanceValue.assertSameCurrency(money);

    if (!money.isPositive()) {
      throw new InvalidWalletAmountError(money);
    }
  }

  private applyBalanceChange(balance: Money, at: Date): void {
    this.balanceValue = balance;
    this.versionValue += 1;
    this.updatedAtValue = new Date(at.getTime());
  }
}
