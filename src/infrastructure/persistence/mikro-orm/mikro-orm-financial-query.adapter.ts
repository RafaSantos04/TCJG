import { Injectable } from '@nestjs/common';
import {
  ConnectionException,
  EntityManager,
  QueryOrder,
} from '@mikro-orm/core';
import { TransientPersistenceError } from '../../../shared/application/errors/persistence.error.js';
import type {
  FinancialQueryPort,
  WagerTransactionReadModel,
  WalletLedgerEntryReadModel,
  WalletReadModel,
} from '../../../shared/application/ports/financial-query.port.js';
import type { FailureCode } from '../../../wagering/domain/value-objects/failure-code.js';
import type { WagerTransactionKind } from '../../../wagering/domain/value-objects/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../../../wagering/domain/value-objects/wager-transaction-status.js';
import type { WalletLedgerDirection } from '../../../wallet/domain/entities/wallet-ledger-entry.js';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity.js';
import { WalletEntity } from './entities/wallet.entity.js';

@Injectable()
export class MikroOrmFinancialQueryAdapter implements FinancialQueryPort {
  constructor(private readonly entityManager: EntityManager) { }

  async findWallet(walletId: string): Promise<WalletReadModel | undefined> {
    const em = this.entityManager.fork();
    return this.query(async () => {
      const entity = await em.findOne(WalletEntity, {
        id: walletId,
      });

      return entity
        ? Object.freeze({
          id: entity.id,
          playerId: entity.playerId,
          balance: {
            amount: entity.balance,
            currency: entity.currency.trim(),
          },
          version: entity.version,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        })
        : undefined;
    });
  }

  async listWalletLedger(
    walletId: string,
    afterSequence: string | undefined,
    limit: number,
  ): Promise<readonly WalletLedgerEntryReadModel[]> {
    const em = this.entityManager.fork();
    return this.query(async () => {
      const entities = await em.find(
        WalletLedgerEntryEntity,
        {
          walletId,
          ...(afterSequence ? { seq: { $gt: afterSequence } } : {}),
        },
        { orderBy: { seq: QueryOrder.ASC }, limit },
      );

      return entities.map((entity) =>
        Object.freeze({
          sequence: entity.seq,
          walletId: entity.walletId,
          transactionId: entity.transactionId,
          direction: entity.direction as WalletLedgerDirection,
          money: {
            amount: entity.amount,
            currency: entity.currency.trim(),
          },
          balanceBefore: {
            amount: entity.balanceBefore,
            currency: entity.currency.trim(),
          },
          balanceAfter: {
            amount: entity.balanceAfter,
            currency: entity.currency.trim(),
          },
          createdAt: entity.createdAt,
        }),
      );
    });
  }

  async findWagerById(
    transactionId: string,
  ): Promise<WagerTransactionReadModel | undefined> {
    const em = this.entityManager.fork();
    return this.query(async () => {
      const entity = await em.findOne(WagerTransactionEntity, {
        id: transactionId,
      });
      return entity ? this.toWager(entity) : undefined;
    });
  }

  async findWagerByProviderTransaction(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionReadModel | undefined> {
    const em = this.entityManager.fork();
    return this.query(async () => {
      const entity = await em.findOne(WagerTransactionEntity, {
        providerId,
        externalTransactionId,
      });
      return entity ? this.toWager(entity) : undefined;
    });
  }

  private async query<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ConnectionException) {
        throw new TransientPersistenceError(
          'The database is temporarily unavailable',
        );
      }
      throw error;
    }
  }

  private toWager(entity: WagerTransactionEntity): WagerTransactionReadModel {
    return Object.freeze({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind as WagerTransactionKind,
      money: {
        amount: entity.amount,
        currency: entity.currency.trim(),
      },
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      referenceTransactionId: entity.referenceTransactionId,
      status: entity.status as WagerTransactionStatus,
      failureCode: entity.failureCode as FailureCode | undefined,
      balanceAfter:
        entity.balanceAfter === undefined
          ? undefined
          : {
            amount: entity.balanceAfter,
            currency: entity.currency.trim(),
          },
      createdAt: entity.createdAt,
      processedAt: entity.processedAt,
    });
  }
}
