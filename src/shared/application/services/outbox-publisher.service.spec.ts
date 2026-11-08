import { ConfigService } from '@nestjs/config';
import type { IntegrationEventPublisherPort } from '../ports/integration-event-publisher.port.js';
import type {
  ClaimedOutboxMessage,
  OutboxRepositoryPort,
} from '../ports/outbox-repository.port.js';
import { OutboxMessage } from '../../domain/entities/outbox-message.js';
import { WalletBalanceChanged } from '../../domain/events/financial-integration-events.js';
import { OutboxPublisherService } from './outbox-publisher.service.js';

function message(): OutboxMessage {
  return OutboxMessage.enqueue(
    WalletBalanceChanged.create({
      aggregateId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      correlationId: 'correlation-a',
      occurredAt: new Date('2026-11-07T18:00:00.000Z'),
      data: {
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        transactionId: '0192f298-345e-7e38-af88-e43f851a819d',
        direction: 'CREDIT',
        money: { amount: '1.00', currency: 'BRL' },
        balanceBefore: { amount: '0.00', currency: 'BRL' },
        balanceAfter: { amount: '1.00', currency: 'BRL' },
        walletVersion: 2,
      },
    }),
  );
}

class FakeRepository implements OutboxRepositoryPort {
  claims: ClaimedOutboxMessage[] = [];
  published: string[] = [];
  retried: OutboxMessage[] = [];

  async claimBatch(): Promise<ClaimedOutboxMessage[]> {
    return this.claims;
  }

  async markPublished(id: string): Promise<boolean> {
    this.published.push(id);
    return true;
  }

  async scheduleRetry(outbox: OutboxMessage): Promise<boolean> {
    this.retried.push(outbox);
    return true;
  }

  async getLagSeconds(): Promise<number> {
    return 3;
  }
}

const config = new ConfigService({
  OUTBOX_BATCH_SIZE: 50,
  OUTBOX_LEASE_MS: 30_000,
  OUTBOX_RETRY_BASE_MS: 1_000,
  OUTBOX_RETRY_MAX_MS: 60_000,
  OUTBOX_RETRY_JITTER: 0,
  OUTBOX_MAX_ATTEMPTS: 10,
});

describe('OutboxPublisherService', () => {
  it('marks a message only after the publisher succeeds', async () => {
    const repository = new FakeRepository();
    const outbox = message();
    repository.claims = [{ message: outbox, leaseUntil: new Date() }];
    const publish = vi.fn(async () => undefined);
    const publisher: IntegrationEventPublisherPort = { publish };
    const service = new OutboxPublisherService(repository, publisher, config);

    const stats = await service.runOnce();

    expect(publish).toHaveBeenCalledWith(outbox);
    expect(repository.published).toEqual([outbox.id]);
    expect(stats).toEqual({
      claimed: 1,
      published: 1,
      retried: 0,
      leaseLost: 0,
      maxAttemptsReached: 0,
    });
  });

  it('schedules retry and does not mark published when SQS fails', async () => {
    const repository = new FakeRepository();
    const outbox = message();
    repository.claims = [{ message: outbox, leaseUntil: new Date() }];
    const publisher: IntegrationEventPublisherPort = {
      publish: vi.fn(async () => {
        throw new Error('SQS unavailable');
      }),
    };
    const service = new OutboxPublisherService(repository, publisher, config);

    const stats = await service.runOnce();

    expect(repository.published).toEqual([]);
    expect(repository.retried[0]?.attempts).toBe(1);
    expect(repository.retried[0]?.lastError).toBe('SQS unavailable');
    expect(stats.retried).toBe(1);
  });
});
