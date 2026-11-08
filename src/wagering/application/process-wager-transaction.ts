import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FINANCIAL_TRANSACTION_PORT,
  type FinancialTransactionContext,
  type FinancialTransactionPort,
  type PendingReferenceSchedule,
  type PersistedWagerTransaction,
} from '../../shared/application/ports/financial-transaction.port.js';
import {
  TransientPersistenceError,
  UniqueConstraintPersistenceError,
} from '../../shared/application/errors/persistence.error.js';
import { OutboxMessage } from '../../shared/domain/entities/outbox-message.js';
import {
  WagerTransactionProcessed,
  WagerTransactionPendingReference,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../../shared/domain/events/financial-integration-events.js';
import {
  Money,
  type SerializedMoney,
} from '../../shared/domain/value-objects/money.js';
import { InsufficientFundsError } from '../../wallet/domain/errors/insufficient-funds.error.js';
import type { WalletLedgerEntry } from '../../wallet/domain/entities/wallet-ledger-entry.js';
import type { Wallet } from '../../wallet/domain/aggregates/wallet.js';
import { WagerTransaction } from '../domain/entities/wager-transaction.js';
import { InvalidExternalTransactionKindError } from '../domain/errors/invalid-external-transaction-kind.error.js';
import {
  FailureCode,
  type FailureCode as FailureCodeValue,
} from '../domain/value-objects/failure-code.js';
import {
  WagerTransactionKind,
  type WagerTransactionKind as WagerTransactionKindValue,
} from '../domain/value-objects/wager-transaction-kind.js';
import {
  WagerTransactionStatus,
  type WagerTransactionStatus as WagerTransactionStatusValue,
} from '../domain/value-objects/wager-transaction-status.js';
import { IdempotencyConflictError } from './errors/idempotency-conflict.error.js';
import { WagerTransactionConflictError } from './errors/wager-transaction-conflict.error.js';
import { WalletNotFoundError } from './errors/wallet-not-found.error.js';

export type ProcessWagerTransactionCommand = Readonly<{
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: Extract<
    WagerTransactionKindValue,
    'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK'
  >;
  money: SerializedMoney;
  referenceExternalTransactionId?: string;
}>;

export type ProcessWagerTransactionResult = Readonly<{
  transactionId: string;
  status: WagerTransactionStatusValue;
  failureCode?: FailureCodeValue;
  balance: SerializedMoney;
  idempotentReplay: boolean;
}>;

@Injectable()
export class ProcessWagerTransaction {
  constructor(
    @Inject(FINANCIAL_TRANSACTION_PORT)
    private readonly transactions: FinancialTransactionPort,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async execute(
    command: ProcessWagerTransactionCommand,
    transactionContext?: FinancialTransactionContext,
  ): Promise<ProcessWagerTransactionResult> {
    const now = new Date();
    const candidate = WagerTransaction.create({
      id: randomUUID(),
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      walletId: command.walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: Money.from(command.money.amount, command.money.currency),
      referenceExternalTransactionId: command.referenceExternalTransactionId,
      createdAt: now,
    });

    if (transactionContext) {
      return this.processInTransaction(transactionContext, candidate, now);
    }

    try {
      return await this.transactions.run((context) =>
        this.processInTransaction(context, candidate, now),
      );
    } catch (error) {
      if (error instanceof UniqueConstraintPersistenceError) {
        return this.resolveInsertRace(candidate);
      }

      throw error;
    }
  }

  async retryPending(
    transactionId: string,
    attempts: number,
  ): Promise<'processed' | 'rejected' | 'rescheduled' | 'skipped'> {
    return this.transactions.run(async (context) => {
      const persisted = await context.lockWagerById(transactionId);
      if (
        !persisted ||
        persisted.transaction.status !==
          WagerTransactionStatus.PENDING_REFERENCE
      ) {
        return 'skipped';
      }

      const transaction = persisted.transaction;
      const wallet = await context.lockWallet(transaction.walletId);
      if (!wallet) {
        throw new WalletNotFoundError(transaction.walletId);
      }
      const reference = await this.findAvailableReference(context, transaction);
      const now = new Date();

      if (!reference) {
        const maxAttempts =
          this.config?.get<number>('PENDING_REFERENCE_MAX_ATTEMPTS') ?? 10;
        if (attempts >= maxAttempts) {
          transaction.reject(FailureCode.REFERENCE_NOT_FOUND);
          await this.persistResult(
            context,
            transaction,
            wallet.balance,
            now,
            wallet.version,
            undefined,
            undefined,
            WagerTransactionStatus.PENDING_REFERENCE,
          );
          return 'rejected';
        }

        const baseDelayMs =
          this.config?.get<number>('PENDING_REFERENCE_RETRY_BASE_MS') ?? 1_000;
        const maxDelayMs =
          this.config?.get<number>('PENDING_REFERENCE_RETRY_MAX_MS') ?? 300_000;
        const delayMs = Math.min(2 ** attempts * baseDelayMs, maxDelayMs);
        const rescheduled = await context.reschedulePendingWager(
          transaction.id,
          new Date(now.getTime() + delayMs),
        );
        if (!rescheduled) {
          throw new TransientPersistenceError(
            `Pending reference ${transaction.id} could not be rescheduled`,
          );
        }
        return 'rescheduled';
      }

      const result = await this.processResolvedReversal(
        context,
        transaction,
        wallet,
        reference.transaction,
        now,
        WagerTransactionStatus.PENDING_REFERENCE,
      );
      return result.status === WagerTransactionStatus.PROCESSED
        ? 'processed'
        : 'rejected';
    });
  }

  private async processInTransaction(
    context: FinancialTransactionContext,
    candidate: WagerTransaction,
    now: Date,
  ): Promise<ProcessWagerTransactionResult> {
    const byIdempotencyKey = await context.findWagerByIdempotencyKey(
      candidate.idempotencyKey,
    );
    if (byIdempotencyKey) {
      return this.replay(candidate, byIdempotencyKey);
    }

    const byProviderTransaction = await context.findWagerByProviderTransaction(
      candidate.providerId,
      candidate.externalTransactionId,
    );
    if (byProviderTransaction) {
      if (
        byProviderTransaction.transaction.idempotencyKey ===
        candidate.idempotencyKey
      ) {
        return this.replay(candidate, byProviderTransaction);
      }
      throw new WagerTransactionConflictError(
        candidate.providerId,
        candidate.externalTransactionId,
      );
    }

    const wallet = await context.lockWallet(candidate.walletId);
    if (!wallet) {
      throw new WalletNotFoundError(candidate.walletId);
    }

    if (wallet.playerId !== candidate.playerId) {
      candidate.reject(FailureCode.PLAYER_WALLET_MISMATCH);
      return this.persistResult(
        context,
        candidate,
        wallet.balance,
        now,
        wallet.version,
      );
    }

    if (wallet.currency !== candidate.money.currency) {
      candidate.reject(FailureCode.CURRENCY_MISMATCH);
      return this.persistResult(
        context,
        candidate,
        wallet.balance,
        now,
        wallet.version,
      );
    }

    if (candidate.requiresReference()) {
      const reference = await this.findAvailableReference(context, candidate);
      if (!reference) {
        candidate.markPendingReference();
        const initialDelayMs =
          this.config?.get<number>('PENDING_REFERENCE_INITIAL_DELAY_MS') ??
          2_000;
        return this.persistResult(
          context,
          candidate,
          wallet.balance,
          now,
          wallet.version,
          undefined,
          {
            attempts: 0,
            nextAttemptAt: new Date(now.getTime() + initialDelayMs),
          },
        );
      }

      return this.processResolvedReversal(
        context,
        candidate,
        wallet,
        reference.transaction,
        now,
      );
    }

    const expectedVersion = wallet.version;
    let ledgerEntry;

    switch (candidate.kind) {
      case WagerTransactionKind.BET:
        try {
          ledgerEntry = wallet.debit(candidate.money, candidate.id, now);
          candidate.markProcessed(undefined, now);
        } catch (error) {
          if (!(error instanceof InsufficientFundsError)) {
            throw error;
          }
          candidate.reject(FailureCode.INSUFFICIENT_FUNDS);
        }
        break;
      case WagerTransactionKind.WIN:
        ledgerEntry = wallet.credit(candidate.money, candidate.id, now);
        candidate.markProcessed(undefined, now);
        break;
      case WagerTransactionKind.LOSS:
        candidate.markProcessed(undefined, now);
        break;
      default:
        throw new InvalidExternalTransactionKindError(candidate.kind);
    }

    if (ledgerEntry) {
      const updated = await context.updateWallet(wallet, expectedVersion);
      if (!updated) {
        throw new TransientPersistenceError(
          `Wallet ${wallet.id} changed despite its write lock`,
        );
      }
    }

    return this.persistResult(
      context,
      candidate,
      wallet.balance,
      now,
      wallet.version,
      ledgerEntry,
    );
  }

  private async findAvailableReference(
    context: FinancialTransactionContext,
    transaction: WagerTransaction,
  ): Promise<PersistedWagerTransaction | undefined> {
    const referenceExternalTransactionId =
      transaction.referenceExternalTransactionId;
    if (!referenceExternalTransactionId) return undefined;
    const reference = await context.findWagerByProviderTransaction(
      transaction.providerId,
      referenceExternalTransactionId,
    );
    if (
      !reference ||
      reference.transaction.status === WagerTransactionStatus.PENDING ||
      reference.transaction.status === WagerTransactionStatus.PENDING_REFERENCE
    ) {
      return undefined;
    }
    return reference;
  }

  private async processResolvedReversal(
    context: FinancialTransactionContext,
    transaction: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction,
    now: Date,
    expectedStatus?: WagerTransactionStatusValue,
  ): Promise<ProcessWagerTransactionResult> {
    const failureCode = await this.validateReference(
      context,
      transaction,
      reference,
    );
    const expectedVersion = wallet.version;
    let ledgerEntry: WalletLedgerEntry | undefined;

    if (failureCode) {
      transaction.reject(failureCode);
    } else {
      const direction = transaction.ledgerDirectionFor(reference);
      try {
        ledgerEntry =
          direction === 'CREDIT'
            ? wallet.credit(transaction.money, transaction.id, now)
            : wallet.debit(transaction.money, transaction.id, now);
        transaction.markProcessed(reference.id, now);
      } catch (error) {
        if (!(error instanceof InsufficientFundsError)) throw error;
        transaction.reject(FailureCode.REVERSAL_INSUFFICIENT_FUNDS);
      }
    }

    if (ledgerEntry) {
      const updated = await context.updateWallet(wallet, expectedVersion);
      if (!updated) {
        throw new TransientPersistenceError(
          `Wallet ${wallet.id} changed despite its write lock`,
        );
      }
    }

    return this.persistResult(
      context,
      transaction,
      wallet.balance,
      now,
      wallet.version,
      ledgerEntry,
      undefined,
      expectedStatus,
    );
  }

  private async validateReference(
    context: FinancialTransactionContext,
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): Promise<FailureCodeValue | undefined> {
    if (reference.status !== WagerTransactionStatus.PROCESSED) {
      return FailureCode.INVALID_REFERENCE_STATE;
    }
    if (
      reference.providerId !== transaction.providerId ||
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.money.currency !== transaction.money.currency ||
      reference.roundId !== transaction.roundId
    ) {
      return FailureCode.REFERENCE_MISMATCH;
    }
    if (
      transaction.kind === WagerTransactionKind.REFUND &&
      reference.kind !== WagerTransactionKind.BET
    ) {
      return FailureCode.INVALID_REFERENCE_KIND;
    }
    if (
      transaction.kind === WagerTransactionKind.ROLLBACK &&
      reference.kind !== WagerTransactionKind.BET &&
      reference.kind !== WagerTransactionKind.WIN &&
      reference.kind !== WagerTransactionKind.REFUND
    ) {
      return FailureCode.INVALID_REFERENCE_KIND;
    }
    if (!transaction.money.equals(reference.money)) {
      return FailureCode.AMOUNT_MISMATCH;
    }
    if (
      transaction.kind !== WagerTransactionKind.REFUND &&
      transaction.kind !== WagerTransactionKind.ROLLBACK
    ) {
      return FailureCode.INVALID_REFERENCE_KIND;
    }
    const previous = await context.findProcessedReversal(
      reference.id,
      transaction.kind,
    );
    return previous ? FailureCode.ALREADY_REVERSED : undefined;
  }

  private async persistResult(
    context: FinancialTransactionContext,
    transaction: WagerTransaction,
    balanceAfter: Money,
    now: Date,
    walletVersion: number,
    ledgerEntry?: WalletLedgerEntry,
    pendingReference?: PendingReferenceSchedule,
    expectedStatus?: WagerTransactionStatusValue,
  ): Promise<ProcessWagerTransactionResult> {
    if (expectedStatus) {
      const updated = await context.updateWager(
        transaction,
        balanceAfter,
        expectedStatus,
      );
      if (!updated) {
        throw new TransientPersistenceError(
          `Wager transaction ${transaction.id} changed during reprocessing`,
        );
      }
    } else {
      await context.insertWager(transaction, balanceAfter, pendingReference);
    }
    if (ledgerEntry) {
      await context.insertLedgerEntry(ledgerEntry);
    }
    const eventProps = {
      aggregateId: transaction.id,
      correlationId: transaction.id,
      causationId: transaction.idempotencyKey,
      occurredAt: now,
      data: {
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        referenceExternalTransactionId:
          transaction.referenceExternalTransactionId,
        referenceTransactionId: transaction.referenceTransactionId,
        kind: transaction.kind,
        status: transaction.status,
        failureCode: transaction.failureCode,
        money: transaction.money.toJSON(),
        balance: balanceAfter.toJSON(),
      },
    };
    const transactionEvent =
      transaction.status === WagerTransactionStatus.PENDING_REFERENCE
        ? WagerTransactionPendingReference.create(eventProps)
        : transaction.failureCode
          ? WagerTransactionRejected.create(eventProps)
          : WagerTransactionProcessed.create(eventProps);
    await context.insertOutbox(OutboxMessage.enqueue(transactionEvent));

    if (ledgerEntry) {
      await context.insertOutbox(
        OutboxMessage.enqueue(
          WalletBalanceChanged.create({
            aggregateId: transaction.walletId,
            correlationId: transaction.id,
            causationId: transaction.id,
            occurredAt: now,
            data: {
              walletId: transaction.walletId,
              transactionId: transaction.id,
              direction: ledgerEntry.direction,
              money: ledgerEntry.money.toJSON(),
              balanceBefore: ledgerEntry.balanceBefore.toJSON(),
              balanceAfter: ledgerEntry.balanceAfter.toJSON(),
              walletVersion,
            },
          }),
        ),
      );
    }

    return ProcessWagerTransaction.toResult(transaction, balanceAfter, false);
  }

  private async resolveInsertRace(
    candidate: WagerTransaction,
  ): Promise<ProcessWagerTransactionResult> {
    const maxReloadAttempts = 3;

    for (let attempt = 1; attempt <= maxReloadAttempts; attempt += 1) {
      try {
        const result = await this.transactions.run(async (context) => {
          const byIdempotencyKey = await context.findWagerByIdempotencyKey(
            candidate.idempotencyKey,
          );
          if (byIdempotencyKey) {
            return this.replay(candidate, byIdempotencyKey);
          }

          const byProviderTransaction =
            await context.findWagerByProviderTransaction(
              candidate.providerId,
              candidate.externalTransactionId,
            );
          if (byProviderTransaction) {
            if (
              byProviderTransaction.transaction.idempotencyKey ===
              candidate.idempotencyKey
            ) {
              return this.replay(candidate, byProviderTransaction);
            }
            throw new WagerTransactionConflictError(
              candidate.providerId,
              candidate.externalTransactionId,
            );
          }

          return undefined;
        });
        if (result) return result;
      } catch (error) {
        if (
          !(error instanceof TransientPersistenceError) ||
          attempt === maxReloadAttempts
        ) {
          throw error;
        }
      }

      if (attempt < maxReloadAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 5 * 2 ** (attempt - 1)),
        );
      }
    }

    throw new TransientPersistenceError(
      'The conflicting transaction could not be reloaded after 3 attempts',
    );
  }

  private replay(
    candidate: WagerTransaction,
    persisted: PersistedWagerTransaction,
  ): ProcessWagerTransactionResult {
    if (!persisted.transaction.matchesPayload(candidate.payloadHash)) {
      throw new IdempotencyConflictError(candidate.idempotencyKey);
    }

    return ProcessWagerTransaction.toResult(
      persisted.transaction,
      persisted.balanceAfter,
      true,
    );
  }

  private static toResult(
    transaction: WagerTransaction,
    balance: Money,
    idempotentReplay: boolean,
  ): ProcessWagerTransactionResult {
    return Object.freeze({
      transactionId: transaction.id,
      status: transaction.status,
      failureCode: transaction.failureCode,
      balance: balance.toJSON(),
      idempotentReplay,
    });
  }
}
