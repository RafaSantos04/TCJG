import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Money,
  type SerializedMoney,
} from '../../shared/domain/value-objects/money.js';
import { WagerTransaction } from '../../wagering/domain/entities/wager-transaction.js';
import { WagerTransactionKind } from '../../wagering/domain/value-objects/wager-transaction-kind.js';
import {
  FINANCIAL_TRANSACTION_PORT,
  type FinancialTransactionPort,
} from '../../shared/application/ports/financial-transaction.port.js';
import { UniqueConstraintPersistenceError } from '../../shared/application/errors/persistence.error.js';
import { createOutboxRecord } from '../../shared/application/services/outbox-record.factory.js';
import { Wallet } from '../domain/aggregates/wallet.js';
import { WalletAlreadyExistsError } from './errors/wallet-already-exists.error.js';

export type CreateWalletCommand = Readonly<{
  playerId: string;
  initialBalance: SerializedMoney;
}>;

export type CreateWalletResult = Readonly<{
  id: string;
  playerId: string;
  balance: SerializedMoney;
  version: number;
}>;

@Injectable()
export class CreateWallet {
  constructor(
    @Inject(FINANCIAL_TRANSACTION_PORT)
    private readonly transactions: FinancialTransactionPort,
  ) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    const initialBalance = Money.from(
      command.initialBalance.amount,
      command.initialBalance.currency,
    );
    const walletId = randomUUID();
    const openingTransactionId = randomUUID();
    const now = new Date();

    try {
      return await this.transactions.run(async (context) => {
        if (initialBalance.isZero()) {
          const wallet = Wallet.open({
            id: walletId,
            playerId: command.playerId,
            currency: initialBalance.currency,
            at: now,
          });
          await context.insertWallet(wallet);
          return CreateWallet.toResult(wallet);
        }

        const { wallet, ledgerEntry } = Wallet.openWithInitialBalance({
          id: walletId,
          playerId: command.playerId,
          initialBalance,
          openingTransactionId,
          at: now,
        });
        const opening = WagerTransaction.create({
          id: openingTransactionId,
          providerId: 'internal',
          externalTransactionId: `opening:${walletId}`,
          idempotencyKey: `internal:opening:${walletId}`,
          walletId,
          playerId: command.playerId,
          roundId: `internal:opening:${walletId}`,
          gameId: 'internal',
          kind: WagerTransactionKind.OPENING,
          money: initialBalance,
          createdAt: now,
        });
        opening.markProcessed(undefined, now);

        await context.insertWallet(wallet);
        await context.insertWager(opening, wallet.balance);
        await context.insertLedgerEntry(ledgerEntry);
        await context.insertOutbox(
          createOutboxRecord({
            eventType: 'WagerTransactionProcessed',
            aggregateId: opening.id,
            correlationId: opening.id,
            causationId: opening.idempotencyKey,
            occurredAt: now,
            data: {
              transactionId: opening.id,
              walletId,
              providerId: opening.providerId,
              externalTransactionId: opening.externalTransactionId,
              kind: opening.kind,
              money: opening.money.toJSON(),
              balance: wallet.balance.toJSON(),
            },
          }),
        );
        await context.insertOutbox(
          createOutboxRecord({
            eventType: 'WalletBalanceChanged',
            aggregateId: wallet.id,
            correlationId: opening.id,
            causationId: opening.id,
            occurredAt: now,
            data: {
              walletId,
              transactionId: opening.id,
              direction: ledgerEntry.direction,
              money: ledgerEntry.money.toJSON(),
              balanceBefore: ledgerEntry.balanceBefore.toJSON(),
              balanceAfter: ledgerEntry.balanceAfter.toJSON(),
              version: wallet.version,
            },
          }),
        );

        return CreateWallet.toResult(wallet);
      });
    } catch (error) {
      if (
        error instanceof UniqueConstraintPersistenceError &&
        error.constraint === 'wallets_player_currency_unique'
      ) {
        throw new WalletAlreadyExistsError(
          command.playerId,
          initialBalance.currency,
        );
      }

      throw error;
    }
  }

  private static toResult(wallet: Wallet): CreateWalletResult {
    return Object.freeze({
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    });
  }
}
