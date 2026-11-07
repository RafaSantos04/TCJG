import { Migration } from '@mikro-orm/migrations';

export class Migration20261107160000InitialFinancialSchema extends Migration {
  override name = 'Migration20261107160000InitialFinancialSchema';

  override up(): void {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" uuid not null,
        "balance" numeric(20,2) not null,
        "currency" char(3) not null,
        "version" integer not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id"),
        constraint "wallets_player_currency_unique" unique ("player_id", "currency"),
        constraint "wallets_balance_non_negative" check ("balance" >= 0),
        constraint "wallets_currency_format" check ("currency" ~ '^[A-Z]{3}$'),
        constraint "wallets_version_positive" check ("version" >= 1)
      );
    `);

    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "provider_id" varchar(255) not null,
        "external_transaction_id" varchar(255) not null,
        "idempotency_key" varchar(512) not null,
        "payload_hash" char(64) not null,
        "wallet_id" uuid not null,
        "player_id" uuid not null,
        "round_id" varchar(255) not null,
        "game_id" varchar(255) not null,
        "kind" varchar(20) not null,
        "amount" numeric(20,2) not null,
        "currency" char(3) not null,
        "reference_external_transaction_id" varchar(255) null,
        "reference_transaction_id" uuid null,
        "status" varchar(30) not null,
        "failure_code" varchar(50) null,
        "balance_after" numeric(20,2) null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "wager_transactions_provider_external_unique" unique ("provider_id", "external_transaction_id"),
        constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key"),
        constraint "wager_transactions_wallet_foreign" foreign key ("wallet_id") references "wallets" ("id") on update cascade on delete restrict,
        constraint "wager_transactions_reference_foreign" foreign key ("reference_transaction_id") references "wager_transactions" ("id") on update cascade on delete restrict,
        constraint "wager_transactions_payload_hash_format" check ("payload_hash" ~ '^[0-9a-f]{64}$'),
        constraint "wager_transactions_kind_valid" check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        constraint "wager_transactions_status_valid" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        constraint "wager_transactions_failure_code_valid" check (
          "failure_code" is null or "failure_code" in (
            'INSUFFICIENT_FUNDS',
            'REVERSAL_INSUFFICIENT_FUNDS',
            'CURRENCY_MISMATCH',
            'WALLET_NOT_FOUND',
            'PLAYER_WALLET_MISMATCH',
            'REFERENCE_NOT_FOUND',
            'REFERENCE_MISMATCH',
            'INVALID_REFERENCE_KIND',
            'INVALID_REFERENCE_STATE',
            'AMOUNT_MISMATCH',
            'ALREADY_REVERSED',
            'INTERNAL_FAILURE'
          )
        ),
        constraint "wager_transactions_amount_positive" check ("amount" > 0),
        constraint "wager_transactions_currency_format" check ("currency" ~ '^[A-Z]{3}$'),
        constraint "wager_transactions_reference_required" check (
          "kind" not in ('REFUND', 'ROLLBACK') or "reference_external_transaction_id" is not null
        ),
        constraint "wager_transactions_resolved_reference_required" check (
          "kind" not in ('REFUND', 'ROLLBACK') or "status" <> 'PROCESSED' or "reference_transaction_id" is not null
        ),
        constraint "wager_transactions_failure_code_required" check (
          "status" not in ('REJECTED', 'FAILED') or "failure_code" is not null
        ),
        constraint "wager_transactions_balance_after_non_negative" check (
          "balance_after" is null or "balance_after" >= 0
        ),
        constraint "wager_transactions_processed_balance_required" check (
          "status" <> 'PROCESSED' or "balance_after" is not null
        ),
        constraint "wager_transactions_attempts_non_negative" check ("attempts" >= 0),
        constraint "wager_transactions_opening_internal" check (
          "kind" <> 'OPENING' or (
            "provider_id" = 'internal'
            and "idempotency_key" = 'internal:opening:' || "wallet_id"::text
          )
        )
      );
    `);

    this.addSql(`
      create unique index "wager_transactions_processed_reversal_unique"
      on "wager_transactions" ("reference_transaction_id", "kind")
      where "kind" in ('REFUND', 'ROLLBACK') and "status" = 'PROCESSED';
    `);
    this.addSql(`
      create index "wager_transactions_provider_reference_idx"
      on "wager_transactions" ("provider_id", "reference_external_transaction_id");
    `);
    this.addSql(`
      create index "wager_transactions_pending_reference_idx"
      on "wager_transactions" ("next_attempt_at")
      where "status" = 'PENDING_REFERENCE';
    `);

    this.addSql(`
      create table "wallet_ledger_entries" (
        "seq" bigserial not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(10) not null,
        "amount" numeric(20,2) not null,
        "currency" char(3) not null,
        "balance_before" numeric(20,2) not null,
        "balance_after" numeric(20,2) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("seq"),
        constraint "wallet_ledger_entries_transaction_wallet_unique" unique ("transaction_id", "wallet_id"),
        constraint "wallet_ledger_entries_wallet_foreign" foreign key ("wallet_id") references "wallets" ("id") on update cascade on delete restrict,
        constraint "wallet_ledger_entries_transaction_foreign" foreign key ("transaction_id") references "wager_transactions" ("id") on update cascade on delete restrict,
        constraint "wallet_ledger_entries_direction_valid" check ("direction" in ('DEBIT', 'CREDIT')),
        constraint "wallet_ledger_entries_amount_positive" check ("amount" > 0),
        constraint "wallet_ledger_entries_currency_format" check ("currency" ~ '^[A-Z]{3}$'),
        constraint "wallet_ledger_entries_balance_before_non_negative" check ("balance_before" >= 0),
        constraint "wallet_ledger_entries_balance_after_non_negative" check ("balance_after" >= 0),
        constraint "wallet_ledger_entries_arithmetic_valid" check (
          ("direction" = 'CREDIT' and "balance_before" + "amount" = "balance_after")
          or
          ("direction" = 'DEBIT' and "balance_before" - "amount" = "balance_after")
        )
      );
    `);
    this.addSql(`
      create index "wallet_ledger_entries_wallet_seq_idx"
      on "wallet_ledger_entries" ("wallet_id", "seq");
    `);

    this.addSql(`
      create function "prevent_wallet_ledger_mutation"()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'wallet ledger entries are append-only'
          using errcode = '55000';
      end;
      $$;
    `);
    this.addSql(`
      create trigger "wallet_ledger_entries_immutable"
      before update or delete on "wallet_ledger_entries"
      for each row execute function "prevent_wallet_ledger_mutation"();
    `);

    this.addSql(`
      create table "inbox_messages" (
        "consumer_name" varchar(255) not null,
        "message_id" varchar(255) not null,
        "payload_hash" char(64) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("consumer_name", "message_id"),
        constraint "inbox_messages_payload_hash_format" check ("payload_hash" ~ '^[0-9a-f]{64}$')
      );
    `);

    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" uuid not null,
        "event_type" varchar(255) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        "last_error" text null,
        constraint "outbox_messages_pkey" primary key ("id"),
        constraint "outbox_messages_attempts_non_negative" check ("attempts" >= 0),
        constraint "outbox_messages_payload_object" check (jsonb_typeof("payload") = 'object')
      );
    `);
    this.addSql(`
      create index "outbox_messages_pending_idx"
      on "outbox_messages" ("next_attempt_at")
      where "published_at" is null;
    `);
  }

  override down(): void {
    this.addSql('drop table if exists "outbox_messages" cascade;');
    this.addSql('drop table if exists "inbox_messages" cascade;');
    this.addSql('drop table if exists "wallet_ledger_entries" cascade;');
    this.addSql('drop table if exists "wager_transactions" cascade;');
    this.addSql('drop table if exists "wallets" cascade;');
    this.addSql('drop function if exists "prevent_wallet_ledger_mutation"();');
  }
}
