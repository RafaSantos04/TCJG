import { Money } from '../../../../shared/domain/value-objects/money.js';
import {
  WagerTransaction,
  type RehydrateWagerTransaction,
} from '../../../../wagering/domain/entities/wager-transaction.js';
import type { FailureCode } from '../../../../wagering/domain/value-objects/failure-code.js';
import type { WagerTransactionKind } from '../../../../wagering/domain/value-objects/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../../../../wagering/domain/value-objects/wager-transaction-status.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';

export class WagerTransactionMapper {
  static toDomain(entity: WagerTransactionEntity): WagerTransaction {
    const state: RehydrateWagerTransaction = {
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind as WagerTransactionKind,
      money: Money.from(entity.amount, entity.currency.trim()),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: entity.status as WagerTransactionStatus,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode as FailureCode | undefined,
      processedAt: entity.processedAt,
    };

    return WagerTransaction.rehydrate(state);
  }

  static toPersistence(
    transaction: WagerTransaction,
    balanceAfter?: Money,
  ): WagerTransactionEntity {
    const entity = new WagerTransactionEntity();
    entity.id = transaction.id;
    entity.providerId = transaction.providerId;
    entity.externalTransactionId = transaction.externalTransactionId;
    entity.idempotencyKey = transaction.idempotencyKey;
    entity.payloadHash = transaction.payloadHash;
    entity.walletId = transaction.walletId;
    entity.playerId = transaction.playerId;
    entity.roundId = transaction.roundId;
    entity.gameId = transaction.gameId;
    entity.kind = transaction.kind;
    entity.amount = transaction.money.amount;
    entity.currency = transaction.money.currency;
    entity.referenceExternalTransactionId =
      transaction.referenceExternalTransactionId;
    entity.referenceTransactionId = transaction.referenceTransactionId;
    entity.status = transaction.status;
    entity.failureCode = transaction.failureCode;
    entity.balanceAfter = balanceAfter?.amount;
    entity.createdAt = transaction.createdAt;
    entity.processedAt = transaction.processedAt;

    return entity;
  }
}
