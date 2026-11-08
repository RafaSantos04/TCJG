import type { OutboxMessage } from '../../domain/entities/outbox-message.js';

export const OUTBOX_REPOSITORY_PORT = Symbol('OUTBOX_REPOSITORY_PORT');

export type ClaimedOutboxMessage = Readonly<{
  message: OutboxMessage;
  leaseUntil: Date;
}>;

export interface OutboxRepositoryPort {
  claimBatch(limit: number, leaseMs: number): Promise<ClaimedOutboxMessage[]>;
  markPublished(id: string, leaseUntil: Date): Promise<boolean>;
  scheduleRetry(message: OutboxMessage, leaseUntil: Date): Promise<boolean>;
  getLagSeconds(): Promise<number>;
  getPendingCount(): Promise<number>;
}
