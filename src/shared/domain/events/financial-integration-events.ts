import type { SerializedMoney } from '../value-objects/money.js';
import type { FailureCode } from '../../../wagering/domain/value-objects/failure-code.js';
import type { WagerTransactionKind } from '../../../wagering/domain/value-objects/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../../../wagering/domain/value-objects/wager-transaction-status.js';
import type { WalletLedgerDirection } from '../../../wallet/domain/entities/wallet-ledger-entry.js';
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from './integration-event.js';

export type WagerTransactionEventData = Readonly<{
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  money: SerializedMoney;
  balance: SerializedMoney;
}>;

export type WalletBalanceChangedData = Readonly<{
  walletId: string;
  transactionId: string;
  direction: WalletLedgerDirection;
  money: SerializedMoney;
  balanceBefore: SerializedMoney;
  balanceAfter: SerializedMoney;
  walletVersion: number;
}>;

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionEventData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static create(props: IntegrationEventProps<WagerTransactionEventData>) {
    return new WagerTransactionProcessed(props);
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionEventData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static create(props: IntegrationEventProps<WagerTransactionEventData>) {
    return new WagerTransactionRejected(props);
  }
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static create(props: IntegrationEventProps<WalletBalanceChangedData>) {
    return new WalletBalanceChanged(props);
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionEventData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static create(props: IntegrationEventProps<WagerTransactionEventData>) {
    return new WagerTransactionPendingReference(props);
  }
}
