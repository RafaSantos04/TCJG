import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migration20261107160000InitialFinancialSchema } from '../../src/infrastructure/persistence/mikro-orm/migrations/Migration20261107160000InitialFinancialSchema.js';
import { financialEntities } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm.options.js';

type WagerInput = Readonly<{
  id?: string;
  providerId?: string;
  externalTransactionId?: string;
  idempotencyKey?: string;
  walletId: string;
  playerId: string;
  kind?: string;
  amount?: string;
  currency?: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  status?: string;
  failureCode?: string;
  balanceAfter?: string;
}>;

async function createTestOrm() {
  return MikroORM.init({
    driver: PostgreSqlDriver,
    clientUrl:
      process.env.TEST_DATABASE_URL ??
      'postgresql://tcjg:tcjg@localhost:5433/tcjg',
    entities: financialEntities,
    metadataProvider: ReflectMetadataProvider,
    extensions: [Migrator],
    pool: { min: 1, max: 2 },
    migrations: {
      migrationsList: [Migration20261107160000InitialFinancialSchema],
      tableName: 'mikro_orm_migrations',
      transactional: true,
      allOrNothing: true,
    },
  });
}

describe.sequential('financial schema migration and constraints', () => {
  const schema = `phase_six_${randomUUID().replaceAll('-', '')}`;
  let orm: Awaited<ReturnType<typeof createTestOrm>>;

  const table = (name: string): string => `"${schema}"."${name}"`;

  const insertWallet = async (
    id: string,
    playerId: string,
    balance = '100.00',
    currency = 'BRL',
  ): Promise<void> => {
    await orm.em.getConnection().execute(
      `insert into ${table('wallets')}
        (id, player_id, balance, currency, version, created_at, updated_at)
       values (?, ?, ?, ?, 1, now(), now())`,
      [id, playerId, balance, currency],
      'run',
    );
  };

  const insertWager = async (input: WagerInput): Promise<string> => {
    const id = input.id ?? randomUUID();
    const uniqueSuffix = randomUUID();

    await orm.em.getConnection().execute(
      `insert into ${table('wager_transactions')} (
        id,
        provider_id,
        external_transaction_id,
        idempotency_key,
        payload_hash,
        wallet_id,
        player_id,
        round_id,
        game_id,
        kind,
        amount,
        currency,
        reference_external_transaction_id,
        reference_transaction_id,
        status,
        failure_code,
        balance_after,
        created_at,
        processed_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), ?)`,
      [
        id,
        input.providerId ?? `provider-${uniqueSuffix}`,
        input.externalTransactionId ?? `external-${uniqueSuffix}`,
        input.idempotencyKey ?? `key-${uniqueSuffix}`,
        'a'.repeat(64),
        input.walletId,
        input.playerId,
        `round-${uniqueSuffix}`,
        `game-${uniqueSuffix}`,
        input.kind ?? 'BET',
        input.amount ?? '10.00',
        input.currency ?? 'BRL',
        input.referenceExternalTransactionId ?? null,
        input.referenceTransactionId ?? null,
        input.status ?? 'PENDING',
        input.failureCode ?? null,
        input.balanceAfter ?? null,
        input.status === 'PROCESSED' ? new Date() : null,
      ],
      'run',
    );

    return id;
  };

  beforeAll(async () => {
    orm = await createTestOrm();

    await orm.migrator.up({ schema });
  }, 60_000);

  afterAll(async () => {
    if (orm) {
      await orm.em
        .getConnection()
        .execute(`drop schema if exists "${schema}" cascade`);
      await orm.close(true);
    }
  }, 30_000);

  it('runs up, down and up with all five tables', async () => {
    const migrator = orm.migrator;

    await migrator.down({ schema });

    const afterDown = await orm.em
      .getConnection()
      .execute<Array<{ table_name: string | null }>>(
        `select to_regclass('${schema}.wallets') as table_name`,
      );
    expect(afterDown[0]?.table_name).toBeNull();

    await migrator.up({ schema });

    const tables = await orm.em.getConnection().execute<
      Array<{ table_name: string | null }>
    >(`
      select table_name
      from information_schema.tables
      where table_schema = '${schema}'
        and table_name in (
          'wallets',
          'wager_transactions',
          'wallet_ledger_entries',
          'inbox_messages',
          'outbox_messages'
        )
      order by table_name
    `);

    expect(tables.map((row) => row.table_name)).toEqual([
      'inbox_messages',
      'outbox_messages',
      'wager_transactions',
      'wallet_ledger_entries',
      'wallets',
    ]);
  }, 60_000);

  it('enforces wallet uniqueness and non-negative balance', async () => {
    const playerId = randomUUID();
    await insertWallet(randomUUID(), playerId);

    await expect(insertWallet(randomUUID(), playerId)).rejects.toThrow();
    await expect(
      insertWallet(randomUUID(), randomUUID(), '-0.01'),
    ).rejects.toThrow();
  });

  it('enforces provider transaction and idempotency uniqueness', async () => {
    const walletId = randomUUID();
    const playerId = randomUUID();
    await insertWallet(walletId, playerId);

    await insertWager({
      walletId,
      playerId,
      providerId: 'provider-unique',
      externalTransactionId: 'external-unique',
      idempotencyKey: 'key-unique',
    });

    await expect(
      insertWager({
        walletId,
        playerId,
        providerId: 'provider-unique',
        externalTransactionId: 'external-unique',
        idempotencyKey: 'different-key',
      }),
    ).rejects.toThrow();

    await expect(
      insertWager({
        walletId,
        playerId,
        providerId: 'different-provider',
        externalTransactionId: 'different-external',
        idempotencyKey: 'key-unique',
      }),
    ).rejects.toThrow();
  });

  it('requires references and failure codes for their corresponding states', async () => {
    const walletId = randomUUID();
    const playerId = randomUUID();
    await insertWallet(walletId, playerId);

    await expect(
      insertWager({
        walletId,
        playerId,
        kind: 'REFUND',
        referenceExternalTransactionId: undefined,
      }),
    ).rejects.toThrow();

    await expect(
      insertWager({
        walletId,
        playerId,
        status: 'REJECTED',
        failureCode: undefined,
      }),
    ).rejects.toThrow();
  });

  it('enforces ledger arithmetic, uniqueness and append-only behavior', async () => {
    const walletId = randomUUID();
    const playerId = randomUUID();
    await insertWallet(walletId, playerId);
    const transactionId = await insertWager({
      walletId,
      playerId,
      status: 'PROCESSED',
      balanceAfter: '90.00',
    });

    await orm.em.getConnection().execute(
      `insert into ${table('wallet_ledger_entries')}
        (wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
       values (?, ?, 'DEBIT', '10.00', 'BRL', '100.00', '90.00', now())`,
      [walletId, transactionId],
      'run',
    );

    await expect(
      orm.em.getConnection().execute(
        `insert into ${table('wallet_ledger_entries')}
          (wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
         values (?, ?, 'DEBIT', '10.00', 'BRL', '100.00', '90.00', now())`,
        [walletId, transactionId],
        'run',
      ),
    ).rejects.toThrow();

    const invalidTransactionId = await insertWager({ walletId, playerId });
    await expect(
      orm.em.getConnection().execute(
        `insert into ${table('wallet_ledger_entries')}
          (wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
         values (?, ?, 'DEBIT', '10.00', 'BRL', '100.00', '95.00', now())`,
        [walletId, invalidTransactionId],
        'run',
      ),
    ).rejects.toThrow();

    await expect(
      orm.em
        .getConnection()
        .execute(
          `update ${table('wallet_ledger_entries')} set amount = '9.00' where transaction_id = ?`,
          [transactionId],
          'run',
        ),
    ).rejects.toThrow(/append-only/);

    await expect(
      orm.em
        .getConnection()
        .execute(
          `delete from ${table('wallet_ledger_entries')} where transaction_id = ?`,
          [transactionId],
          'run',
        ),
    ).rejects.toThrow(/append-only/);
  });

  it('allows only one processed reversal of each kind per reference', async () => {
    const walletId = randomUUID();
    const playerId = randomUUID();
    await insertWallet(walletId, playerId);
    const referenceId = await insertWager({
      walletId,
      playerId,
      status: 'PROCESSED',
      balanceAfter: '90.00',
    });

    await insertWager({
      walletId,
      playerId,
      kind: 'REFUND',
      referenceExternalTransactionId: 'external-reference',
      referenceTransactionId: referenceId,
      status: 'PROCESSED',
      balanceAfter: '100.00',
    });

    await expect(
      insertWager({
        walletId,
        playerId,
        kind: 'REFUND',
        referenceExternalTransactionId: 'external-reference',
        referenceTransactionId: referenceId,
        status: 'PROCESSED',
        balanceAfter: '100.00',
      }),
    ).rejects.toThrow();
  });
});
