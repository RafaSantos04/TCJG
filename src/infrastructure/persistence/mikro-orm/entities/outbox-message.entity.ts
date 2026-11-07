import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'outbox_messages' })
export class OutboxMessageEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id!: string;

  @Property({ fieldName: 'aggregate_id', columnType: 'uuid' })
  aggregateId!: string;

  @Property({ fieldName: 'event_type', columnType: 'varchar(255)' })
  eventType!: string;

  @Property({ columnType: 'jsonb', runtimeType: 'object' })
  payload!: Record<string, unknown>;

  @Property({ fieldName: 'occurred_at', columnType: 'timestamptz' })
  occurredAt!: Date;

  @Property({ columnType: 'integer', default: 0 })
  attempts = 0;

  @Property({
    fieldName: 'next_attempt_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  nextAttemptAt?: Date;

  @Property({
    fieldName: 'published_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  publishedAt?: Date;

  @Property({ fieldName: 'last_error', columnType: 'text', nullable: true })
  lastError?: string;
}
