import { Injectable } from '@nestjs/common';
import {
  EntityManager,
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import {
  TransientPersistenceError,
  UniqueConstraintPersistenceError,
} from '../../../shared/application/errors/persistence.error.js';
import type {
  FinancialTransactionContext,
  FinancialTransactionPort,
  OutboxRecord,
  PersistedWagerTransaction,
} from '../../../shared/application/ports/financial-transaction.port.js';
import { Money } from '../../../shared/domain/value-objects/money.js';
import type { WagerTransaction } from '../../../wagering/domain/entities/wager-transaction.js';
import type { Wallet } from '../../../wallet/domain/aggregates/wallet.js';
import type { WalletLedgerEntry } from '../../../wallet/domain/entities/wallet-ledger-entry.js';
import { OutboxMessageEntity } from './entities/outbox-message.entity.js';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WalletEntity } from './entities/wallet.entity.js';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper.js';
import { WalletLedgerEntryMapper } from './mappers/wallet-ledger-entry.mapper.js';
import { WalletMapper } from './mappers/wallet.mapper.js';

type DatabaseError = Readonly<{
  code?: string;
  constraint?: string;
  cause?: unknown;
}>;

@Injectable()
export class MikroOrmFinancialTransactionAdapter implements FinancialTransactionPort {
  constructor(private readonly entityManager: EntityManager) {}

  async run<T>(
    work: (context: FinancialTransactionContext) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.entityManager.transactional(
        async (transactionalEntityManager) => {
          const transactionContext =
            transactionalEntityManager.getTransactionContext();
          await transactionalEntityManager
            .getConnection()
            .execute(
              `set local lock_timeout = '5s'`,
              [],
              'run',
              transactionContext,
            );

          return work(
            new MikroOrmFinancialTransactionContext(transactionalEntityManager),
          );
        },
        { clear: true },
      );
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new UniqueConstraintPersistenceError(
          MikroOrmFinancialTransactionAdapter.databaseError(error).constraint,
        );
      }

      const databaseError =
        MikroOrmFinancialTransactionAdapter.databaseError(error);
      if (databaseError.code === '23505') {
        throw new UniqueConstraintPersistenceError(databaseError.constraint);
      }

      if (['40P01', '55P03', '57014'].includes(databaseError.code ?? '')) {
        throw new TransientPersistenceError(
          'The wallet is temporarily busy; retry the operation',
        );
      }

      throw error;
    }
  }

  private static databaseError(error: unknown): DatabaseError {
    if (!error || typeof error !== 'object') {
      return {};
    }

    const candidate = error as DatabaseError;
    if (candidate.code || candidate.constraint) {
      return candidate;
    }

    return candidate.cause
      ? MikroOrmFinancialTransactionAdapter.databaseError(candidate.cause)
      : candidate;
  }
}

class MikroOrmFinancialTransactionContext implements FinancialTransactionContext {
  constructor(private readonly entityManager: EntityManager) {}

  async findWagerByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PersistedWagerTransaction | undefined> {
    const entity = await this.entityManager.findOne(WagerTransactionEntity, {
      idempotencyKey,
    });

    return entity ? this.toPersistedWager(entity) : undefined;
  }

  async findWagerByProviderTransaction(
    providerId: string,
    externalTransactionId: string,
  ): Promise<PersistedWagerTransaction | undefined> {
    const entity = await this.entityManager.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });

    return entity ? this.toPersistedWager(entity) : undefined;
  }

  async lockWallet(walletId: string): Promise<Wallet | undefined> {
    const entity = await this.entityManager.findOne(
      WalletEntity,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );

    return entity ? WalletMapper.toDomain(entity) : undefined;
  }

  async insertWallet(wallet: Wallet): Promise<void> {
    await this.entityManager.insert(
      WalletEntity,
      WalletMapper.toPersistence(wallet),
    );
  }

  async updateWallet(
    wallet: Wallet,
    expectedVersion: number,
  ): Promise<boolean> {
    const updatedRows = await this.entityManager.nativeUpdate(
      WalletEntity,
      { id: wallet.id, version: expectedVersion },
      {
        balance: wallet.balance.amount,
        currency: wallet.currency,
        version: wallet.version,
        updatedAt: wallet.updatedAt,
      },
    );

    return updatedRows === 1;
  }

  async insertWager(
    transaction: WagerTransaction,
    balanceAfter: Money,
  ): Promise<void> {
    await this.entityManager.insert(
      WagerTransactionEntity,
      WagerTransactionMapper.toPersistence(transaction, balanceAfter),
    );
  }

  async insertLedgerEntry(entry: WalletLedgerEntry): Promise<void> {
    await this.entityManager.insert(
      WalletLedgerEntryMapper.toPersistence(entry),
    );
  }

  async insertOutbox(record: OutboxRecord): Promise<void> {
    const entity = new OutboxMessageEntity();
    entity.id = record.id;
    entity.aggregateId = record.aggregateId;
    entity.eventType = record.eventType;
    entity.payload = record.payload;
    entity.occurredAt = record.occurredAt;
    entity.attempts = 0;
    entity.nextAttemptAt = record.occurredAt;
    await this.entityManager.insert(OutboxMessageEntity, entity);
  }

  private toPersistedWager(
    entity: WagerTransactionEntity,
  ): PersistedWagerTransaction {
    if (entity.balanceAfter === undefined) {
      throw new Error(
        `Persisted transaction ${entity.id} has no replay balance`,
      );
    }

    return Object.freeze({
      transaction: WagerTransactionMapper.toDomain(entity),
      balanceAfter: Money.from(entity.balanceAfter, entity.currency.trim()),
    });
  }
}
