import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wager_transactions' })
export class WagerTransactionEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id!: string;

  @Property({ fieldName: 'provider_id', columnType: 'varchar(255)' })
  providerId!: string;

  @Property({
    fieldName: 'external_transaction_id',
    columnType: 'varchar(255)',
  })
  externalTransactionId!: string;

  @Property({ fieldName: 'idempotency_key', columnType: 'varchar(512)' })
  idempotencyKey!: string;

  @Property({ fieldName: 'payload_hash', columnType: 'char(64)' })
  payloadHash!: string;

  @Property({ fieldName: 'wallet_id', columnType: 'uuid' })
  walletId!: string;

  @Property({ fieldName: 'player_id', columnType: 'uuid' })
  playerId!: string;

  @Property({ fieldName: 'round_id', columnType: 'varchar(255)' })
  roundId!: string;

  @Property({ fieldName: 'game_id', columnType: 'varchar(255)' })
  gameId!: string;

  @Property({ columnType: 'varchar(20)' })
  kind!: string;

  @Property({ columnType: 'numeric(20,2)' })
  amount!: string;

  @Property({ columnType: 'char(3)' })
  currency!: string;

  @Property({
    fieldName: 'reference_external_transaction_id',
    columnType: 'varchar(255)',
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @Property({
    fieldName: 'reference_transaction_id',
    columnType: 'uuid',
    nullable: true,
  })
  referenceTransactionId?: string;

  @Property({ columnType: 'varchar(30)' })
  status!: string;

  @Property({
    fieldName: 'failure_code',
    columnType: 'varchar(50)',
    nullable: true,
  })
  failureCode?: string;

  @Property({
    fieldName: 'balance_after',
    columnType: 'numeric(20,2)',
    nullable: true,
  })
  balanceAfter?: string;

  @Property({ columnType: 'integer', default: 0 })
  attempts = 0;

  @Property({
    fieldName: 'next_attempt_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  nextAttemptAt?: Date;

  @Property({ fieldName: 'created_at', columnType: 'timestamptz' })
  createdAt!: Date;

  @Property({
    fieldName: 'processed_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  processedAt?: Date;
}
