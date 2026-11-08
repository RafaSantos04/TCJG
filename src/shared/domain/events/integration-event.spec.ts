import { version } from 'uuid';
import { OutboxMessage } from '../entities/outbox-message.js';
import {
  WagerTransactionProcessed,
  WagerTransactionPendingReference,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from './financial-integration-events.js';

describe('IntegrationEvent and OutboxMessage', () => {
  it('serializes a typed event with a UUID v7 identifier', () => {
    const event = WagerTransactionProcessed.create({
      aggregateId: '0192f298-345e-7e38-af88-e43f851a819d',
      correlationId: 'correlation-a',
      causationId: 'causation-a',
      occurredAt: new Date('2026-11-07T18:00:00.000Z'),
      data: {
        transactionId: '0192f298-345e-7e38-af88-e43f851a819d',
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        providerId: 'provider-a',
        externalTransactionId: 'external-a',
        kind: 'LOSS',
        status: 'PROCESSED',
        money: { amount: '10.00', currency: 'BRL' },
        balance: { amount: '100.00', currency: 'BRL' },
      },
    });

    expect(version(event.eventId)).toBe(7);
    expect(event.toJSON()).toMatchObject({
      eventType: 'WagerTransactionProcessed',
      version: 1,
      occurredAt: '2026-11-07T18:00:00.000Z',
      data: { kind: 'LOSS' },
    });
  });

  it('enqueues the serialized event and calculates deterministic retry', () => {
    const event = WalletBalanceChanged.create({
      aggregateId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      correlationId: 'correlation-a',
      occurredAt: new Date('2026-11-07T18:00:00.000Z'),
      data: {
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        transactionId: '0192f298-345e-7e38-af88-e43f851a819d',
        direction: 'CREDIT',
        money: { amount: '10.00', currency: 'BRL' },
        balanceBefore: { amount: '90.00', currency: 'BRL' },
        balanceAfter: { amount: '100.00', currency: 'BRL' },
        walletVersion: 2,
      },
    });
    const message = OutboxMessage.enqueue(event);

    message.scheduleRetry(
      new Date('2026-11-07T18:00:01.000Z'),
      'SQS unavailable',
      {
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        jitterRatio: 0.2,
        random: () => 0.5,
      },
    );

    expect(message.id).toBe(event.eventId);
    expect(message.payload).toEqual(event.toJSON());
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt?.toISOString()).toBe(
      '2026-11-07T18:00:02.000Z',
    );
    expect(message.lastError).toBe('SQS unavailable');
  });

  it('keeps eventType and version on all four concrete event types', () => {
    const props = {
      aggregateId: '0192f298-345e-7e38-af88-e43f851a819d',
      correlationId: 'correlation-a',
      occurredAt: new Date('2026-11-07T18:00:00.000Z'),
      data: {
        transactionId: '0192f298-345e-7e38-af88-e43f851a819d',
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        providerId: 'provider-a',
        externalTransactionId: 'external-a',
        kind: 'BET' as const,
        status: 'REJECTED' as const,
        failureCode: 'INSUFFICIENT_FUNDS' as const,
        money: { amount: '10.00', currency: 'BRL' },
        balance: { amount: '0.00', currency: 'BRL' },
      },
    };

    expect(WagerTransactionRejected.create(props)).toMatchObject({
      eventType: 'WagerTransactionRejected',
      version: 1,
    });
    expect(
      WagerTransactionPendingReference.create({
        ...props,
        data: { ...props.data, status: 'PENDING_REFERENCE' },
      }),
    ).toMatchObject({
      eventType: 'WagerTransactionPendingReference',
      version: 1,
    });
  });
});
