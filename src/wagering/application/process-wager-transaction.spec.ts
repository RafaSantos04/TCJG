import type {
  FinancialTransactionContext,
  FinancialTransactionPort,
  OutboxRecord,
  PersistedWagerTransaction,
} from '../../shared/application/ports/financial-transaction.port.js';
import { UniqueConstraintPersistenceError } from '../../shared/application/errors/persistence.error.js';
import { Money } from '../../shared/domain/value-objects/money.js';
import { Wallet } from '../../wallet/domain/aggregates/wallet.js';
import type { WalletLedgerEntry } from '../../wallet/domain/entities/wallet-ledger-entry.js';
import { WagerTransaction } from '../domain/entities/wager-transaction.js';
import { WagerTransactionKind } from '../domain/value-objects/wager-transaction-kind.js';
import { IdempotencyConflictError } from './errors/idempotency-conflict.error.js';
import {
  ProcessWagerTransaction,
  type ProcessWagerTransactionCommand,
} from './process-wager-transaction.js';

const baseCommand: ProcessWagerTransactionCommand = {
  providerId: 'provider-a',
  externalTransactionId: 'external-a',
  idempotencyKey: 'provider-a:external-a',
  playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
  walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
  roundId: 'round-a',
  gameId: 'game-a',
  kind: 'BET',
  money: { amount: '80.00', currency: 'BRL' },
};

function walletWith(amount = '100.00'): Wallet {
  return Wallet.rehydrate({
    id: baseCommand.walletId,
    playerId: baseCommand.playerId,
    balance: Money.from(amount, 'BRL'),
    version: 1,
    createdAt: new Date('2026-11-07T18:00:00.000Z'),
    updatedAt: new Date('2026-11-07T18:00:00.000Z'),
  });
}

function persistedFor(
  command: ProcessWagerTransactionCommand = baseCommand,
  balanceAfter = '20.00',
): PersistedWagerTransaction {
  const transaction = WagerTransaction.create({
    id: '0192f298-345e-7e38-af88-e43f851a819d',
    ...command,
    money: Money.from(command.money.amount, command.money.currency),
    createdAt: new Date('2026-11-07T18:00:00.000Z'),
  });
  transaction.markProcessed(undefined, new Date('2026-11-07T18:00:01.000Z'));
  return {
    transaction,
    balanceAfter: Money.from(balanceAfter, 'BRL'),
  };
}

class RecordingContext implements FinancialTransactionContext {
  wallet: Wallet | undefined = walletWith();
  byKey?: PersistedWagerTransaction;
  byProvider?: PersistedWagerTransaction;
  insertedWager?: WagerTransaction;
  insertedLedger?: WalletLedgerEntry;
  updatedWallet?: Wallet;
  readonly outbox: OutboxRecord[] = [];

  async findWagerByIdempotencyKey(): Promise<
    PersistedWagerTransaction | undefined
  > {
    return this.byKey;
  }

  async findWagerByProviderTransaction(): Promise<
    PersistedWagerTransaction | undefined
  > {
    return this.byProvider;
  }

  async lockWallet(): Promise<Wallet | undefined> {
    return this.wallet;
  }

  async insertWallet(): Promise<void> {}

  async updateWallet(wallet: Wallet): Promise<boolean> {
    this.updatedWallet = wallet;
    return true;
  }

  async insertWager(
    transaction: WagerTransaction,
    _balanceAfter: Money,
  ): Promise<void> {
    this.insertedWager = transaction;
  }

  async insertLedgerEntry(entry: WalletLedgerEntry): Promise<void> {
    this.insertedLedger = entry;
  }

  async insertOutbox(record: OutboxRecord): Promise<void> {
    this.outbox.push(record);
  }
}

class QueueTransactionPort implements FinancialTransactionPort {
  constructor(private readonly queue: Array<RecordingContext | Error>) {}

  async run<T>(
    work: (context: FinancialTransactionContext) => Promise<T>,
  ): Promise<T> {
    const next = this.queue.shift();
    if (!next) {
      throw new Error('No fake transaction configured');
    }
    if (next instanceof Error) {
      throw next;
    }
    return work(next);
  }
}

describe('ProcessWagerTransaction', () => {
  it('processes a BET with wallet, ledger and outbox changes', async () => {
    const context = new RecordingContext();
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const result = await useCase.execute(baseCommand);

    expect(result).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '20.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(context.updatedWallet?.version).toBe(2);
    expect(context.insertedLedger?.direction).toBe('DEBIT');
    expect(context.outbox.map((record) => record.eventType)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
  });

  it('persists insufficient funds as REJECTED without ledger movement', async () => {
    const context = new RecordingContext();
    context.wallet = walletWith('20.00');
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const result = await useCase.execute(baseCommand);

    expect(result).toMatchObject({
      status: 'REJECTED',
      failureCode: 'INSUFFICIENT_FUNDS',
      balance: { amount: '20.00', currency: 'BRL' },
    });
    expect(context.updatedWallet).toBeUndefined();
    expect(context.insertedLedger).toBeUndefined();
    expect(context.outbox.map((record) => record.eventType)).toEqual([
      'WagerTransactionRejected',
    ]);
  });

  it('processes LOSS without changing wallet or ledger', async () => {
    const context = new RecordingContext();
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const result = await useCase.execute({
      ...baseCommand,
      kind: WagerTransactionKind.LOSS,
    });

    expect(result.status).toBe('PROCESSED');
    expect(result.balance.amount).toBe('100.00');
    expect(context.updatedWallet).toBeUndefined();
    expect(context.insertedLedger).toBeUndefined();
  });

  it('returns the persisted historical balance on replay', async () => {
    const context = new RecordingContext();
    context.byKey = persistedFor();
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const result = await useCase.execute(baseCommand);

    expect(result.transactionId).toBe('0192f298-345e-7e38-af88-e43f851a819d');
    expect(result.balance.amount).toBe('20.00');
    expect(result.idempotentReplay).toBe(true);
    expect(context.insertedWager).toBeUndefined();
  });

  it('rejects an idempotency key reused with a divergent payload', async () => {
    const context = new RecordingContext();
    context.byKey = persistedFor();
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    await expect(
      useCase.execute({
        ...baseCommand,
        money: { amount: '79.00', currency: 'BRL' },
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('reloads the winner after a concurrent 23505 insert race', async () => {
    const reloaded = new RecordingContext();
    reloaded.byKey = persistedFor();
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([
        new UniqueConstraintPersistenceError(
          'wager_transactions_idempotency_key_unique',
        ),
        reloaded,
      ]),
    );

    const result = await useCase.execute(baseCommand);

    expect(result.idempotentReplay).toBe(true);
    expect(result.balance.amount).toBe('20.00');
  });
});
