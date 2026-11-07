import { randomUUID } from 'node:crypto';
import type { OutboxRecord } from '../ports/financial-transaction.port.js';

type CreateOutboxRecord = Readonly<{
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId: string;
  occurredAt: Date;
  data: Record<string, unknown>;
}>;

export function createOutboxRecord(input: CreateOutboxRecord): OutboxRecord {
  const id = randomUUID();
  const occurredAt = new Date(input.occurredAt.getTime());

  return Object.freeze({
    id,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    occurredAt,
    payload: {
      eventId: id,
      eventType: input.eventType,
      version: 1,
      aggregateId: input.aggregateId,
      correlationId: input.correlationId,
      causationId: input.causationId,
      occurredAt: occurredAt.toISOString(),
      data: input.data,
    },
  });
}
