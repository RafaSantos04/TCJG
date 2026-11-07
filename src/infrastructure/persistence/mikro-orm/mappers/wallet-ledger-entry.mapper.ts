import { Money } from '../../../../shared/domain/value-objects/money.js';
import {
  WalletLedgerEntry,
  type WalletLedgerDirection,
} from '../../../../wallet/domain/entities/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';

export class WalletLedgerEntryMapper {
  static toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    const currency = entity.currency.trim();

    return WalletLedgerEntry.rehydrate({
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction as WalletLedgerDirection,
      money: Money.from(entity.amount, currency),
      balanceBefore: Money.from(entity.balanceBefore, currency),
      balanceAfter: Money.from(entity.balanceAfter, currency),
      createdAt: entity.createdAt,
    });
  }

  static toPersistence(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    const entity = new WalletLedgerEntryEntity();
    entity.walletId = entry.walletId;
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.amount = entry.money.amount;
    entity.currency = entry.money.currency;
    entity.balanceBefore = entry.balanceBefore.amount;
    entity.balanceAfter = entry.balanceAfter.amount;
    entity.createdAt = entry.createdAt;

    return entity;
  }
}
