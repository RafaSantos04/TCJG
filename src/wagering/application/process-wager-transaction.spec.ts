import type {
  FinancialTransactionContext,
  FinancialTransactionPort,
  PendingReferenceSchedule,
  PersistedWagerTransaction,
} from '../../shared/application/ports/financial-transaction.port.js';
import { ConfigService } from '@nestjs/config';
import type { OutboxMessage } from '../../shared/domain/entities/outbox-message.js';
import type { InboxMessage } from '../../shared/domain/entities/inbox-message.js';
import { UniqueConstraintPersistenceError } from '../../shared/application/errors/persistence.error.js';
import { Money } from '../../shared/domain/value-objects/money.js';
import { Wallet } from '../../wallet/domain/aggregates/wallet.js';
import type { WalletLedgerEntry } from '../../wallet/domain/entities/wallet-ledger-entry.js';
import { WagerTransaction } from '../domain/entities/wager-transaction.js';
import { WagerTransactionKind } from '../domain/value-objects/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../domain/value-objects/wager-transaction-status.js';
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

function processedReference(
  kind: Extract<
    ProcessWagerTransactionCommand['kind'],
    'BET' | 'WIN' | 'REFUND'
  >,
  overrides: Partial<ProcessWagerTransactionCommand> = {},
): PersistedWagerTransaction {
  const command: ProcessWagerTransactionCommand = {
    ...baseCommand,
    externalTransactionId: `reference-${kind.toLowerCase()}`,
    idempotencyKey: `reference:${kind.toLowerCase()}`,
    kind,
    referenceExternalTransactionId:
      kind === WagerTransactionKind.REFUND ? 'reference-bet' : undefined,
    ...overrides,
  };
  const transaction = WagerTransaction.create({
    id: `transaction-${kind.toLowerCase()}`,
    ...command,
    money: Money.from(command.money.amount, command.money.currency),
    createdAt: new Date('2026-11-07T18:00:00.000Z'),
  });
  transaction.markProcessed(
    transaction.requiresReference() ? 'transaction-bet' : undefined,
    new Date('2026-11-07T18:00:01.000Z'),
  );
  return {
    transaction,
    balanceAfter: Money.from('20.00', 'BRL'),
  };
}

function pendingReversal(
  kind: 'REFUND' | 'ROLLBACK' = 'ROLLBACK',
): PersistedWagerTransaction {
  const command: ProcessWagerTransactionCommand = {
    ...baseCommand,
    externalTransactionId: `pending-${kind.toLowerCase()}`,
    idempotencyKey: `pending:${kind.toLowerCase()}`,
    kind,
    referenceExternalTransactionId: 'reference-bet',
  };
  const transaction = WagerTransaction.create({
    id: `pending-transaction-${kind.toLowerCase()}`,
    ...command,
    money: Money.from(command.money.amount, command.money.currency),
    createdAt: new Date('2026-11-07T18:00:00.000Z'),
  });
  transaction.markPendingReference();
  return {
    transaction,
    balanceAfter: Money.from('20.00', 'BRL'),
  };
}

function rejectedReference(): PersistedWagerTransaction {
  const transaction = WagerTransaction.create({
    id: 'transaction-rejected',
    ...baseCommand,
    externalTransactionId: 'reference-rejected',
    idempotencyKey: 'reference:rejected',
    money: Money.from(baseCommand.money.amount, baseCommand.money.currency),
    createdAt: new Date('2026-11-07T18:00:00.000Z'),
  });
  transaction.reject('INSUFFICIENT_FUNDS');
  return {
    transaction,
    balanceAfter: Money.from('20.00', 'BRL'),
  };
}

class RecordingContext implements FinancialTransactionContext {
  wallet: Wallet | undefined = walletWith();
  byKey?: PersistedWagerTransaction;
  byProvider?: PersistedWagerTransaction;
  readonly providerTransactions = new Map<string, PersistedWagerTransaction>();
  lockedWager?: PersistedWagerTransaction;
  processedReversal?: PersistedWagerTransaction;
  insertedWager?: WagerTransaction;
  updatedWager?: WagerTransaction;
  pendingSchedule?: PendingReferenceSchedule;
  rescheduledAt?: Date;
  insertedLedger?: WalletLedgerEntry;
  updatedWallet?: Wallet;
  readonly outbox: OutboxMessage[] = [];

  async lockWagerById(): Promise<PersistedWagerTransaction | undefined> {
    return this.lockedWager;
  }

  async findProcessedReversal(): Promise<
    PersistedWagerTransaction | undefined
  > {
    return this.processedReversal;
  }

  async updateWager(
    transaction: WagerTransaction,
    _balanceAfter: Money,
    _expectedStatus: WagerTransactionStatus,
  ): Promise<boolean> {
    this.updatedWager = transaction;
    return true;
  }

  async reschedulePendingWager(
    _id: string,
    nextAttemptAt: Date,
  ): Promise<boolean> {
    this.rescheduledAt = nextAttemptAt;
    return true;
  }

  async insertInbox(_message: InboxMessage): Promise<boolean> {
    return true;
  }

  async lockInbox(): Promise<InboxMessage | undefined> {
    return undefined;
  }

  async updateInbox(_message: InboxMessage): Promise<void> {}

  async findWagerByIdempotencyKey(): Promise<
    PersistedWagerTransaction | undefined
  > {
    return this.byKey;
  }

  async findWagerByProviderTransaction(
    _providerId: string,
    externalTransactionId: string,
  ): Promise<PersistedWagerTransaction | undefined> {
    return (
      this.providerTransactions.get(externalTransactionId) ?? this.byProvider
    );
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
    pendingReference?: PendingReferenceSchedule,
  ): Promise<void> {
    this.insertedWager = transaction;
    this.pendingSchedule = pendingReference;
  }

  async insertLedgerEntry(entry: WalletLedgerEntry): Promise<void> {
    this.insertedLedger = entry;
  }

  async insertOutbox(message: OutboxMessage): Promise<void> {
    this.outbox.push(message);
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

  it('processes a REFUND of a processed BET as credit', async () => {
    const context = new RecordingContext();
    context.wallet = walletWith('20.00');
    const reference = processedReference('BET');
    context.providerTransactions.set(
      reference.transaction.externalTransactionId,
      reference,
    );
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const result = await useCase.execute({
      ...baseCommand,
      externalTransactionId: 'refund-a',
      idempotencyKey: 'refund:a',
      kind: 'REFUND',
      referenceExternalTransactionId:
        reference.transaction.externalTransactionId,
    });

    expect(result).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '100.00', currency: 'BRL' },
    });
    expect(context.insertedLedger?.direction).toBe('CREDIT');
    expect(context.insertedWager?.referenceTransactionId).toBe(
      reference.transaction.id,
    );
  });

  it('uses REVERSAL_INSUFFICIENT_FUNDS when rollback debit cannot be applied', async () => {
    const context = new RecordingContext();
    context.wallet = walletWith('20.00');
    const reference = processedReference('WIN');
    context.providerTransactions.set(
      reference.transaction.externalTransactionId,
      reference,
    );
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const result = await useCase.execute({
      ...baseCommand,
      externalTransactionId: 'rollback-win',
      idempotencyKey: 'rollback:win',
      kind: 'ROLLBACK',
      referenceExternalTransactionId:
        reference.transaction.externalTransactionId,
    });

    expect(result).toMatchObject({
      status: 'REJECTED',
      failureCode: 'REVERSAL_INSUFFICIENT_FUNDS',
      balance: { amount: '20.00', currency: 'BRL' },
    });
    expect(context.insertedLedger).toBeUndefined();
  });

  it('persists a missing reference as PENDING_REFERENCE with its event', async () => {
    const context = new RecordingContext();
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
      new ConfigService({ PENDING_REFERENCE_INITIAL_DELAY_MS: 0 }),
    );

    const result = await useCase.execute({
      ...baseCommand,
      externalTransactionId: 'rollback-before-bet',
      idempotencyKey: 'rollback:before-bet',
      kind: 'ROLLBACK',
      referenceExternalTransactionId: 'bet-arrives-later',
    });

    expect(result.status).toBe('PENDING_REFERENCE');
    expect(context.pendingSchedule?.attempts).toBe(0);
    expect(context.outbox.map((record) => record.eventType)).toEqual([
      'WagerTransactionPendingReference',
    ]);
  });

  it.each([
    {
      name: 'reference mismatch',
      mutate: (reference: PersistedWagerTransaction) =>
        processedReference('BET', {
          playerId: `${reference.transaction.playerId}x`,
        }),
      failureCode: 'REFERENCE_MISMATCH',
    },
    {
      name: 'invalid reference kind',
      mutate: () => persistedFor({ ...baseCommand, kind: 'LOSS' }),
      failureCode: 'INVALID_REFERENCE_KIND',
    },
    {
      name: 'amount mismatch',
      mutate: () =>
        processedReference('BET', {
          money: { amount: '79.00', currency: 'BRL' },
        }),
      failureCode: 'AMOUNT_MISMATCH',
    },
    {
      name: 'invalid reference state',
      mutate: () => rejectedReference(),
      failureCode: 'INVALID_REFERENCE_STATE',
    },
  ])('rejects $name', async ({ mutate, failureCode }) => {
    const context = new RecordingContext();
    const baseline = processedReference('BET');
    const reference = mutate(baseline);
    context.providerTransactions.set(
      reference.transaction.externalTransactionId,
      reference,
    );
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const result = await useCase.execute({
      ...baseCommand,
      externalTransactionId: `refund-${failureCode}`,
      idempotencyKey: `refund:${failureCode}`,
      kind: 'REFUND',
      referenceExternalTransactionId:
        reference.transaction.externalTransactionId,
    });

    expect(result).toMatchObject({ status: 'REJECTED', failureCode });
  });

  it('rejects a second processed reversal of the same kind', async () => {
    const context = new RecordingContext();
    const reference = processedReference('BET');
    context.providerTransactions.set(
      reference.transaction.externalTransactionId,
      reference,
    );
    context.processedReversal = processedReference('REFUND');
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const result = await useCase.execute({
      ...baseCommand,
      externalTransactionId: 'refund-duplicate',
      idempotencyKey: 'refund:duplicate',
      kind: 'REFUND',
      referenceExternalTransactionId:
        reference.transaction.externalTransactionId,
    });

    expect(result).toMatchObject({
      status: 'REJECTED',
      failureCode: 'ALREADY_REVERSED',
    });
  });

  it('resolves a pending rollback after its BET arrives', async () => {
    const context = new RecordingContext();
    context.wallet = walletWith('20.00');
    context.lockedWager = pendingReversal();
    const reference = processedReference('BET');
    context.providerTransactions.set('reference-bet', reference);
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
    );

    const outcome = await useCase.retryPending(
      context.lockedWager.transaction.id,
      1,
    );

    expect(outcome).toBe('processed');
    expect(context.updatedWager?.status).toBe('PROCESSED');
    expect(context.updatedWallet?.balance.amount).toBe('100.00');
  });

  it('rejects a pending reversal when the reference never arrives', async () => {
    const context = new RecordingContext();
    context.lockedWager = pendingReversal();
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
      new ConfigService({ PENDING_REFERENCE_MAX_ATTEMPTS: 1 }),
    );

    const outcome = await useCase.retryPending(
      context.lockedWager.transaction.id,
      1,
    );

    expect(outcome).toBe('rejected');
    expect(context.updatedWager?.failureCode).toBe('REFERENCE_NOT_FOUND');
    expect(context.outbox.at(-1)?.eventType).toBe('WagerTransactionRejected');
  });

  it('reschedules a pending reference with exponential backoff', async () => {
    const context = new RecordingContext();
    context.lockedWager = pendingReversal();
    const before = Date.now();
    const useCase = new ProcessWagerTransaction(
      new QueueTransactionPort([context]),
      new ConfigService({
        PENDING_REFERENCE_MAX_ATTEMPTS: 2,
        PENDING_REFERENCE_RETRY_BASE_MS: 100,
        PENDING_REFERENCE_RETRY_MAX_MS: 1_000,
      }),
    );

    const outcome = await useCase.retryPending(
      context.lockedWager.transaction.id,
      1,
    );

    expect(outcome).toBe('rescheduled');
    expect(context.rescheduledAt?.getTime()).toBeGreaterThanOrEqual(
      before + 200,
    );
  });
});
