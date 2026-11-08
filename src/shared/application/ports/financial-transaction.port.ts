import type { Money } from '../../domain/value-objects/money.js';
import type { WagerTransaction } from '../../../wagering/domain/entities/wager-transaction.js';
import type { Wallet } from '../../../wallet/domain/aggregates/wallet.js';
import type { WalletLedgerEntry } from '../../../wallet/domain/entities/wallet-ledger-entry.js';
import type { OutboxMessage } from '../../domain/entities/outbox-message.js';

export const FINANCIAL_TRANSACTION_PORT = Symbol('FINANCIAL_TRANSACTION_PORT');

export type PersistedWagerTransaction = Readonly<{
  transaction: WagerTransaction;
  balanceAfter: Money;
}>;

export interface FinancialTransactionContext {
  findWagerByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PersistedWagerTransaction | undefined>;
  findWagerByProviderTransaction(
    providerId: string,
    externalTransactionId: string,
  ): Promise<PersistedWagerTransaction | undefined>;
  lockWallet(walletId: string): Promise<Wallet | undefined>;
  insertWallet(wallet: Wallet): Promise<void>;
  updateWallet(wallet: Wallet, expectedVersion: number): Promise<boolean>;
  insertWager(
    transaction: WagerTransaction,
    balanceAfter: Money,
  ): Promise<void>;
  insertLedgerEntry(entry: WalletLedgerEntry): Promise<void>;
  insertOutbox(message: OutboxMessage): Promise<void>;
}

export interface FinancialTransactionPort {
  run<T>(
    work: (context: FinancialTransactionContext) => Promise<T>,
  ): Promise<T>;
}
