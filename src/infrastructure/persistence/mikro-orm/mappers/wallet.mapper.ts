import { Money } from '../../../../shared/domain/value-objects/money.js';
import { Wallet } from '../../../../wallet/domain/aggregates/wallet.js';
import { WalletEntity } from '../entities/wallet.entity.js';

export class WalletMapper {
  static toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      balance: Money.from(entity.balance, entity.currency.trim()),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  static toPersistence(wallet: Wallet): WalletEntity {
    const entity = new WalletEntity();
    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.balance = wallet.balance.amount;
    entity.currency = wallet.currency;
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;

    return entity;
  }
}
