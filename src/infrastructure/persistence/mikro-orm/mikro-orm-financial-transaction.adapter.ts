import { Injectable } from '@nestjs/common';
import {
  EntityManager,
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql';
import {
  TransientPersistenceError,
  UniqueConstraintPersistenceError,
} from '../../../shared/application/errors/persistence.error.js';
import type {
  FinancialTransactionContext,
  FinancialTransactionPort,
  PendingReferenceSchedule,
  PersistedWagerTransaction,
} from '../../../shared/application/ports/financial-transaction.port.js';
import type { OutboxMessage } from '../../../shared/domain/entities/outbox-message.js';
import { InboxMessage } from '../../../shared/domain/entities/inbox-message.js';
import { Money } from '../../../shared/domain/value-objects/money.js';
import type { WagerTransaction } from '../../../wagering/domain/entities/wager-transaction.js';
import type { WagerTransactionKind } from '../../../wagering/domain/value-objects/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../../../wagering/domain/value-objects/wager-transaction-status.js';
import type { Wallet } from '../../../wallet/domain/aggregates/wallet.js';
import type { WalletLedgerEntry } from '../../../wallet/domain/entities/wallet-ledger-entry.js';
import { OutboxMessageEntity } from './entities/outbox-message.entity.js';
import { InboxMessageEntity } from './entities/inbox-message.entity.js';
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

  async insertInbox(message: InboxMessage): Promise<boolean> {
    const rows = await (this.entityManager as PostgreSqlEntityManager)
      .createQueryBuilder(InboxMessageEntity)
      .insert({
        consumerName: message.consumerName,
        messageId: message.messageId,
        payloadHash: message.payloadHash,
        receivedAt: message.receivedAt,
        processedAt: message.processedAt,
      })
      .onConflict(['consumerName', 'messageId'])
      .ignore()
      .returning('messageId')
      .execute<Array<{ messageId: string }>>('all');

    return rows.length === 1;
  }

  async lockInbox(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | undefined> {
    const entity = await this.entityManager.findOne(
      InboxMessageEntity,
      { consumerName, messageId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );

    return entity
      ? InboxMessage.rehydrate({
          consumerName: entity.consumerName,
          messageId: entity.messageId,
          payloadHash: entity.payloadHash.trim(),
          receivedAt: entity.receivedAt,
          processedAt: entity.processedAt,
        })
      : undefined;
  }

  async updateInbox(message: InboxMessage): Promise<void> {
    const updatedRows = await this.entityManager.nativeUpdate(
      InboxMessageEntity,
      {
        consumerName: message.consumerName,
        messageId: message.messageId,
        payloadHash: message.payloadHash,
      },
      { processedAt: message.processedAt },
    );
    if (updatedRows !== 1) {
      throw new TransientPersistenceError(
        `Inbox message ${message.consumerName}/${message.messageId} was not updated`,
      );
    }
  }

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

  async lockWagerById(
    id: string,
  ): Promise<PersistedWagerTransaction | undefined> {
    const entity = await this.entityManager.findOne(
      WagerTransactionEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    return entity ? this.toPersistedWager(entity) : undefined;
  }

  async findProcessedReversal(
    referenceTransactionId: string,
    kind: Extract<WagerTransactionKind, 'REFUND' | 'ROLLBACK'>,
  ): Promise<PersistedWagerTransaction | undefined> {
    const entity = await this.entityManager.findOne(WagerTransactionEntity, {
      referenceTransactionId,
      kind,
      status: 'PROCESSED',
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
    pendingReference?: PendingReferenceSchedule,
  ): Promise<void> {
    const entity = WagerTransactionMapper.toPersistence(
      transaction,
      balanceAfter,
    );
    entity.attempts = pendingReference?.attempts ?? 0;
    entity.nextAttemptAt = pendingReference?.nextAttemptAt;
    await this.entityManager.insert(WagerTransactionEntity, entity);
  }

  async updateWager(
    transaction: WagerTransaction,
    balanceAfter: Money,
    expectedStatus: WagerTransactionStatus,
  ): Promise<boolean> {
    const updatedRows = await this.entityManager.nativeUpdate(
      WagerTransactionEntity,
      { id: transaction.id, status: expectedStatus },
      {
        referenceTransactionId: transaction.referenceTransactionId,
        status: transaction.status,
        failureCode: transaction.failureCode,
        balanceAfter: balanceAfter.amount,
        processedAt: transaction.processedAt,
        nextAttemptAt: null,
      },
    );
    return updatedRows === 1;
  }

  async reschedulePendingWager(
    id: string,
    nextAttemptAt: Date,
  ): Promise<boolean> {
    return (
      (await this.entityManager.nativeUpdate(
        WagerTransactionEntity,
        { id, status: 'PENDING_REFERENCE' },
        { nextAttemptAt },
      )) === 1
    );
  }

  async insertLedgerEntry(entry: WalletLedgerEntry): Promise<void> {
    await this.entityManager.insert(
      WalletLedgerEntryMapper.toPersistence(entry),
    );
  }

  async insertOutbox(message: OutboxMessage): Promise<void> {
    const entity = new OutboxMessageEntity();
    entity.id = message.id;
    entity.aggregateId = message.aggregateId;
    entity.eventType = message.eventType;
    entity.payload = message.payload as Record<string, unknown>;
    entity.occurredAt = message.occurredAt;
    entity.attempts = message.attempts;
    entity.nextAttemptAt = message.nextAttemptAt;
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
