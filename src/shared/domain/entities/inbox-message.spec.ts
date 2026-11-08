import { InboxMessage } from './inbox-message.js';

describe('InboxMessage', () => {
  const receivedAt = new Date('2026-11-08T01:00:00.000Z');

  it('receives and marks a message as processed', () => {
    const message = InboxMessage.receive({
      consumerName: 'wager-consumer',
      messageId: 'message-1',
      payloadHash: 'a'.repeat(64),
      receivedAt,
    });

    message.markProcessed(new Date('2026-11-08T01:00:01.000Z'));

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt?.toISOString()).toBe('2026-11-08T01:00:01.000Z');
  });

  it('rehydrates dates returned as strings by the database driver', () => {
    const message = InboxMessage.rehydrate({
      consumerName: 'wager-consumer',
      messageId: 'message-1',
      payloadHash: 'b'.repeat(64),
      receivedAt: '2026-11-08T01:00:00.000Z' as unknown as Date,
      processedAt: '2026-11-08T01:00:01.000Z' as unknown as Date,
    });

    expect(message.isProcessed()).toBe(true);
  });

  it('rejects an invalid payload hash', () => {
    expect(() =>
      InboxMessage.receive({
        consumerName: 'wager-consumer',
        messageId: 'message-1',
        payloadHash: 'invalid',
        receivedAt,
      }),
    ).toThrow('lowercase SHA-256');
  });
});
