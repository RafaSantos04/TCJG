import type {
  FinancialTransactionContext,
  FinancialTransactionPort,
} from '../../shared/application/ports/financial-transaction.port.js';
import type { InboxMessage } from '../../shared/domain/entities/inbox-message.js';
import { InboxPayloadConflictError } from './errors/inbox-payload-conflict.error.js';
import { InvalidWagerMessageError } from './errors/invalid-wager-message.error.js';
import { ProcessWagerMessage } from './process-wager-message.js';
import type { ProcessWagerTransaction } from './process-wager-transaction.js';

describe('ProcessWagerMessage', () => {
  const body = JSON.stringify({
    messageId: 'message-1',
    type: 'WagerTransactionRequested',
    occurredAt: '2026-11-08T01:00:00.000Z',
    data: {
      providerId: 'provider-a',
      externalTransactionId: 'external-a',
      idempotencyKey: 'provider-a:external-a',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      roundId: 'round-a',
      gameId: 'game-a',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    },
  });

  it('stores inbox, runs the HTTP use case and marks inbox processed', async () => {
    const fixture = createFixture();

    const result = await fixture.useCase.execute(body, 'consumer-a');

    expect(result.duplicate).toBe(false);
    expect(fixture.processExecute).toHaveBeenCalledOnce();
    expect(fixture.updateInbox).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'message-1' }),
    );
    expect(fixture.inbox?.isProcessed()).toBe(true);
  });

  it('deduplicates a processed inbox message without running finance twice', async () => {
    const fixture = createFixture();
    await fixture.useCase.execute(body, 'consumer-a');

    const result = await fixture.useCase.execute(body, 'consumer-a');

    expect(result).toEqual({ messageId: 'message-1', duplicate: true });
    expect(fixture.processExecute).toHaveBeenCalledOnce();
  });

  it('rejects reuse of the inbox key with another payload', async () => {
    const fixture = createFixture();
    await fixture.useCase.execute(body, 'consumer-a');
    const changed = body.replace('25.00', '20.00');

    await expect(
      fixture.useCase.execute(changed, 'consumer-a'),
    ).rejects.toBeInstanceOf(InboxPayloadConflictError);
  });

  it('rejects invalid JSON before opening a transaction', async () => {
    const fixture = createFixture();

    await expect(
      fixture.useCase.execute('{invalid', 'consumer-a'),
    ).rejects.toBeInstanceOf(InvalidWagerMessageError);
    expect(fixture.runSpy).not.toHaveBeenCalled();
  });

  function createFixture() {
    let inbox: InboxMessage | undefined;
    const updateInbox = vi.fn(async (message: InboxMessage) => {
      inbox = message;
    });
    const context = {
      insertInbox: vi.fn(async (message: InboxMessage) => {
        if (inbox) return false;
        inbox = message;
        return true;
      }),
      lockInbox: vi.fn(async () => inbox),
      updateInbox,
    } as unknown as FinancialTransactionContext;
    const runSpy = vi.fn();
    const transactions: FinancialTransactionPort = {
      async run<T>(
        work: (transactionContext: FinancialTransactionContext) => Promise<T>,
      ): Promise<T> {
        runSpy();
        return work(context);
      },
    };
    const processExecute = vi.fn(async () => ({
      transactionId: '0192f298-345e-7e38-af88-e43f851a819d',
      status: 'PROCESSED' as const,
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: false,
    }));
    const process = {
      execute: processExecute,
    } as unknown as ProcessWagerTransaction;
    return {
      context,
      updateInbox,
      transactions,
      runSpy,
      process,
      processExecute,
      useCase: new ProcessWagerMessage(transactions, process),
      get inbox() {
        return inbox;
      },
    };
  }
});
