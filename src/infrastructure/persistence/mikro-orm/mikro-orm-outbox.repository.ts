import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import type {
  ClaimedOutboxMessage,
  OutboxRepositoryPort,
} from '../../../shared/application/ports/outbox-repository.port.js';
import { OutboxMessage } from '../../../shared/domain/entities/outbox-message.js';

type OutboxRow = Readonly<{
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts: number;
  next_attempt_at?: Date;
  published_at?: Date;
  last_error?: string;
}>;

@Injectable()
export class MikroOrmOutboxRepository implements OutboxRepositoryPort {
  private readonly table: string;

  constructor(private readonly entityManager: EntityManager) {
    const schema = entityManager.config.getSchema() ?? 'public';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid PostgreSQL schema name: ${schema}`);
    }
    this.table = `"${schema}"."outbox_messages"`;
  }

  async claimBatch(
    limit: number,
    leaseMs: number,
  ): Promise<ClaimedOutboxMessage[]> {
    const rows = await this.entityManager
      .fork()
      .getConnection()
      .execute<OutboxRow[]>(
        `with due as (
           select candidate.id
           from ${this.table} as candidate
           where candidate.published_at is null
             and candidate.next_attempt_at <= now()
             and not exists (
               select 1
               from ${this.table} as prior
               where prior.aggregate_id = candidate.aggregate_id
                 and prior.published_at is null
                 and (prior.occurred_at, prior.id) <
                     (candidate.occurred_at, candidate.id)
             )
           order by candidate.occurred_at, candidate.id
           for update of candidate skip locked
           limit ?
         )
         update ${this.table} as message
         set next_attempt_at = date_trunc('milliseconds', now())
             + (?::integer * interval '1 millisecond')
         from due
         where message.id = due.id
         returning message.*`,
        [limit, leaseMs],
      );

    return rows.map((row: OutboxRow) => {
      const message = this.toDomain(row);
      const leaseUntil = message.nextAttemptAt;
      if (!leaseUntil) throw new Error(`Claimed outbox ${row.id} has no lease`);
      return Object.freeze({ message, leaseUntil });
    });
  }

  async markPublished(id: string, leaseUntil: Date): Promise<boolean> {
    const rows = await this.entityManager
      .fork()
      .getConnection()
      .execute<Array<{ id: string }>>(
        `update ${this.table}
         set published_at = now(), last_error = null
         where id = ? and published_at is null and next_attempt_at = ?
         returning id`,
        [id, leaseUntil],
      );
    return rows.length === 1;
  }

  async scheduleRetry(
    message: OutboxMessage,
    leaseUntil: Date,
  ): Promise<boolean> {
    const rows = await this.entityManager
      .fork()
      .getConnection()
      .execute<Array<{ id: string }>>(
        `update ${this.table}
         set attempts = ?, next_attempt_at = ?, last_error = ?
         where id = ? and published_at is null and next_attempt_at = ?
         returning id`,
        [
          message.attempts,
          message.nextAttemptAt,
          message.lastError,
          message.id,
          leaseUntil,
        ],
      );
    return rows.length === 1;
  }

  async getLagSeconds(): Promise<number> {
    const [row] = await this.entityManager
      .fork()
      .getConnection()
      .execute<Array<{ lag_seconds: string }>>(
        `select coalesce(
           greatest(extract(epoch from (now() - min(occurred_at))), 0), 0
         )::text as lag_seconds
         from ${this.table}
         where published_at is null`,
      );
    return Number(row?.lag_seconds ?? 0);
  }

  private toDomain(row: OutboxRow): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: row.id,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
      occurredAt: row.occurred_at,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      publishedAt: row.published_at,
      lastError: row.last_error,
    });
  }
}
