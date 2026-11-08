import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import type {
  PendingReferenceClaim,
  PendingReferenceRepositoryPort,
} from '../../../shared/application/ports/pending-reference-repository.port.js';

type PendingReferenceRow = Readonly<{
  id: string;
  attempts: number;
  next_attempt_at: Date;
}>;

@Injectable()
export class MikroOrmPendingReferenceRepository implements PendingReferenceRepositoryPort {
  private readonly table: string;

  constructor(private readonly entityManager: EntityManager) {
    const schema = entityManager.config.getSchema() ?? 'public';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid PostgreSQL schema name: ${schema}`);
    }
    this.table = `"${schema}"."wager_transactions"`;
  }

  async claimBatch(
    limit: number,
    leaseMs: number,
  ): Promise<PendingReferenceClaim[]> {
    const rows = await this.entityManager
      .fork()
      .getConnection()
      .execute<PendingReferenceRow[]>(
        `with due as (
           select candidate.id
           from ${this.table} as candidate
           where candidate.status = 'PENDING_REFERENCE'
             and candidate.next_attempt_at <= now()
           order by candidate.next_attempt_at, candidate.created_at, candidate.id
           for update of candidate skip locked
           limit ?
         )
         update ${this.table} as wager
         set attempts = wager.attempts + 1,
             next_attempt_at = date_trunc('milliseconds', now())
               + (?::integer * interval '1 millisecond')
         from due
         where wager.id = due.id
         returning wager.id, wager.attempts, wager.next_attempt_at`,
        [limit, leaseMs],
      );

    return rows.map((row: PendingReferenceRow) =>
      Object.freeze({
        transactionId: row.id,
        attempts: row.attempts,
        leaseUntil: new Date(row.next_attempt_at),
      }),
    );
  }
}
