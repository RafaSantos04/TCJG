import type { Money } from '../../domain/value-objects/money.js';
import type { WagerTransaction } from '../../../wagering/domain/entities/wager-transaction.js';
import type { WagerTransactionKind } from '../../../wagering/domain/value-objects/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../../../wagering/domain/value-objects/wager-transaction-status.js';
import type { Wallet } from '../../../wallet/domain/aggregates/wallet.js';
import type { WalletLedgerEntry } from '../../../wallet/domain/entities/wallet-ledger-entry.js';
import type { OutboxMessage } from '../../domain/entities/outbox-message.js';
import type { InboxMessage } from '../../domain/entities/inbox-message.js';

export const FINANCIAL_TRANSACTION_PORT = Symbol('FINANCIAL_TRANSACTION_PORT');

export type PersistedWagerTransaction = Readonly<{
  transaction: WagerTransaction;
  balanceAfter: Money;
}>;

export type PendingReferenceSchedule = Readonly<{
  attempts: number;
  nextAttemptAt: Date;
}>;

export interface FinancialTransactionContext {
  insertInbox(message: InboxMessage): Promise<boolean>;
  lockInbox(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | undefined>;
  updateInbox(message: InboxMessage): Promise<void>;
  findWagerByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PersistedWagerTransaction | undefined>;
  findWagerByProviderTransaction(
    providerId: string,
    externalTransactionId: string,
  ): Promise<PersistedWagerTransaction | undefined>;
  lockWagerById(id: string): Promise<PersistedWagerTransaction | undefined>;
  findProcessedReversal(
    referenceTransactionId: string,
    kind: Extract<WagerTransactionKind, 'REFUND' | 'ROLLBACK'>,
  ): Promise<PersistedWagerTransaction | undefined>;
  lockWallet(walletId: string): Promise<Wallet | undefined>;
  insertWallet(wallet: Wallet): Promise<void>;
  updateWallet(wallet: Wallet, expectedVersion: number): Promise<boolean>;
  insertWager(
    transaction: WagerTransaction,
    balanceAfter: Money,
    pendingReference?: PendingReferenceSchedule,
  ): Promise<void>;
  updateWager(
    transaction: WagerTransaction,
    balanceAfter: Money,
    expectedStatus: WagerTransactionStatus,
  ): Promise<boolean>;
  reschedulePendingWager(id: string, nextAttemptAt: Date): Promise<boolean>;
  insertLedgerEntry(entry: WalletLedgerEntry): Promise<void>;
  insertOutbox(message: OutboxMessage): Promise<void>;
}

export interface FinancialTransactionPort {
  run<T>(
    work: (context: FinancialTransactionContext) => Promise<T>,
  ): Promise<T>;
}
