import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCIAL_TRANSACTION_PORT,
  type FinancialTransactionContext,
  type FinancialTransactionPort,
  type PersistedWagerTransaction,
} from '../../shared/application/ports/financial-transaction.port.js';
import {
  TransientPersistenceError,
  UniqueConstraintPersistenceError,
} from '../../shared/application/errors/persistence.error.js';
import { OutboxMessage } from '../../shared/domain/entities/outbox-message.js';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../../shared/domain/events/financial-integration-events.js';
import {
  Money,
  type SerializedMoney,
} from '../../shared/domain/value-objects/money.js';
import { InsufficientFundsError } from '../../wallet/domain/errors/insufficient-funds.error.js';
import type { WalletLedgerEntry } from '../../wallet/domain/entities/wallet-ledger-entry.js';
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
import type { WagerTransactionStatus } from '../domain/value-objects/wager-transaction-status.js';
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
  kind: Extract<WagerTransactionKindValue, 'BET' | 'WIN' | 'LOSS'>;
  money: SerializedMoney;
}>;

export type ProcessWagerTransactionResult = Readonly<{
  transactionId: string;
  status: WagerTransactionStatus;
  failureCode?: FailureCodeValue;
  balance: SerializedMoney;
  idempotentReplay: boolean;
}>;

@Injectable()
export class ProcessWagerTransaction {
  constructor(
    @Inject(FINANCIAL_TRANSACTION_PORT)
    private readonly transactions: FinancialTransactionPort,
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

  private async persistResult(
    context: FinancialTransactionContext,
    transaction: WagerTransaction,
    balanceAfter: Money,
    now: Date,
    walletVersion: number,
    ledgerEntry?: WalletLedgerEntry,
  ): Promise<ProcessWagerTransactionResult> {
    await context.insertWager(transaction, balanceAfter);
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
        kind: transaction.kind,
        status: transaction.status,
        failureCode: transaction.failureCode,
        money: transaction.money.toJSON(),
        balance: balanceAfter.toJSON(),
      },
    };
    const transactionEvent = transaction.failureCode
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
    return this.transactions.run(async (context) => {
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
        throw new WagerTransactionConflictError(
          candidate.providerId,
          candidate.externalTransactionId,
        );
      }

      throw new TransientPersistenceError(
        'The conflicting transaction could not be reloaded',
      );
    });
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
