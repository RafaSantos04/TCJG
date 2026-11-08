import { UniqueConstraintPersistenceError } from '../../shared/application/errors/persistence.error.js';
import type {
  FinancialTransactionContext,
  FinancialTransactionPort,
  PersistedWagerTransaction,
} from '../../shared/application/ports/financial-transaction.port.js';
import type { OutboxMessage } from '../../shared/domain/entities/outbox-message.js';
import type { InboxMessage } from '../../shared/domain/entities/inbox-message.js';
import type { Money } from '../../shared/domain/value-objects/money.js';
import type { WagerTransaction } from '../../wagering/domain/entities/wager-transaction.js';
import type { Wallet } from '../domain/aggregates/wallet.js';
import type { WalletLedgerEntry } from '../domain/entities/wallet-ledger-entry.js';
import { WalletAlreadyExistsError } from './errors/wallet-already-exists.error.js';
import { CreateWallet } from './create-wallet.js';

class RecordingContext implements FinancialTransactionContext {
  readonly calls: string[] = [];
  wallet?: Wallet;
  wager?: WagerTransaction;
  ledger?: WalletLedgerEntry;
  readonly outbox: OutboxMessage[] = [];

  async lockWagerById(): Promise<PersistedWagerTransaction | undefined> {
    return undefined;
  }

  async findProcessedReversal(): Promise<
    PersistedWagerTransaction | undefined
  > {
    return undefined;
  }

  async updateWager(): Promise<boolean> {
    return true;
  }

  async reschedulePendingWager(): Promise<boolean> {
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
    return undefined;
  }

  async findWagerByProviderTransaction(): Promise<
    PersistedWagerTransaction | undefined
  > {
    return undefined;
  }

  async lockWallet(): Promise<Wallet | undefined> {
    return undefined;
  }

  async insertWallet(wallet: Wallet): Promise<void> {
    this.calls.push('wallet');
    this.wallet = wallet;
  }

  async updateWallet(): Promise<boolean> {
    return true;
  }

  async insertWager(
    transaction: WagerTransaction,
    _balanceAfter: Money,
  ): Promise<void> {
    this.calls.push('wager');
    this.wager = transaction;
  }

  async insertLedgerEntry(entry: WalletLedgerEntry): Promise<void> {
    this.calls.push('ledger');
    this.ledger = entry;
  }

  async insertOutbox(message: OutboxMessage): Promise<void> {
    this.calls.push(`outbox:${message.eventType}`);
    this.outbox.push(message);
  }
}

class FakeTransactionPort implements FinancialTransactionPort {
  constructor(
    private readonly context: RecordingContext,
    private readonly error?: Error,
  ) {}

  async run<T>(
    work: (context: FinancialTransactionContext) => Promise<T>,
  ): Promise<T> {
    if (this.error) {
      throw this.error;
    }
    return work(this.context);
  }
}

describe('CreateWallet', () => {
  it('persists wallet, OPENING, CREDIT ledger and outbox atomically', async () => {
    const context = new RecordingContext();
    const useCase = new CreateWallet(new FakeTransactionPort(context));

    const result = await useCase.execute({
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    expect(result.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(result.version).toBe(1);
    expect(context.wager?.kind).toBe('OPENING');
    expect(context.wager?.status).toBe('PROCESSED');
    expect(context.ledger?.direction).toBe('CREDIT');
    expect(context.calls).toEqual([
      'wallet',
      'wager',
      'ledger',
      'outbox:WagerTransactionProcessed',
      'outbox:WalletBalanceChanged',
    ]);
  });

  it('does not create OPENING for a zero balance', async () => {
    const context = new RecordingContext();
    const useCase = new CreateWallet(new FakeTransactionPort(context));

    const result = await useCase.execute({
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a2',
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    expect(result.version).toBe(1);
    expect(context.calls).toEqual(['wallet']);
  });

  it('maps the player and currency unique constraint to a business conflict', async () => {
    const context = new RecordingContext();
    const useCase = new CreateWallet(
      new FakeTransactionPort(
        context,
        new UniqueConstraintPersistenceError('wallets_player_currency_unique'),
      ),
    );

    await expect(
      useCase.execute({
        playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a3',
        initialBalance: { amount: '10.00', currency: 'BRL' },
      }),
    ).rejects.toBeInstanceOf(WalletAlreadyExistsError);
  });
});
