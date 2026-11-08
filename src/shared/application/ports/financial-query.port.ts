import type { SerializedMoney } from '../../domain/value-objects/money.js';
import type { FailureCode } from '../../../wagering/domain/value-objects/failure-code.js';
import type { WagerTransactionKind } from '../../../wagering/domain/value-objects/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../../../wagering/domain/value-objects/wager-transaction-status.js';
import type { WalletLedgerDirection } from '../../../wallet/domain/entities/wallet-ledger-entry.js';

export const FINANCIAL_QUERY_PORT = Symbol('FINANCIAL_QUERY_PORT');

export type WalletReadModel = Readonly<{
  id: string;
  playerId: string;
  balance: SerializedMoney;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type WalletLedgerEntryReadModel = Readonly<{
  sequence: string;
  walletId: string;
  transactionId: string;
  direction: WalletLedgerDirection;
  money: SerializedMoney;
  balanceBefore: SerializedMoney;
  balanceAfter: SerializedMoney;
  createdAt: Date;
}>;

export type WalletReconciliationSnapshot = Readonly<{
  wallet: WalletReadModel;
  entries: readonly WalletLedgerEntryReadModel[];
}>;

export type WagerTransactionReadModel = Readonly<{
  id: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: SerializedMoney;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  balanceAfter?: SerializedMoney;
  createdAt: Date;
  processedAt?: Date;
}>;

export interface FinancialQueryPort {
  findWallet(walletId: string): Promise<WalletReadModel | undefined>;
  getWalletReconciliationSnapshot(
    walletId: string,
  ): Promise<WalletReconciliationSnapshot | undefined>;
  listWalletLedger(
    walletId: string,
    afterSequence: string | undefined,
    limit: number,
  ): Promise<readonly WalletLedgerEntryReadModel[]>;
  findWagerById(
    transactionId: string,
  ): Promise<WagerTransactionReadModel | undefined>;
  findWagerByProviderTransaction(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionReadModel | undefined>;
}
