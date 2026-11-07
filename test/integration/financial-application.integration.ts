import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MikroOrmFinancialTransactionAdapter } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm-financial-transaction.adapter.js';
import { Migration20261107160000InitialFinancialSchema } from '../../src/infrastructure/persistence/mikro-orm/migrations/Migration20261107160000InitialFinancialSchema.js';
import { financialEntities } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm.options.js';
import { CreateWallet } from '../../src/wallet/application/create-wallet.js';
import { WalletAlreadyExistsError } from '../../src/wallet/application/errors/wallet-already-exists.error.js';
import { IdempotencyConflictError } from '../../src/wagering/application/errors/idempotency-conflict.error.js';
import { ProcessWagerTransaction } from '../../src/wagering/application/process-wager-transaction.js';

describe.sequential('financial application with PostgreSQL', () => {
  const schema = `phase_seven_${randomUUID().replaceAll('-', '')}`;
  let orm: Awaited<ReturnType<typeof MikroORM.init>>;
  let createWallet: CreateWallet;
  let processWager: ProcessWagerTransaction;

  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      clientUrl:
        process.env.TEST_DATABASE_URL ??
        'postgresql://tcjg:tcjg@127.0.0.1:5433/tcjg',
      schema,
      entities: financialEntities,
      metadataProvider: ReflectMetadataProvider,
      extensions: [Migrator],
      pool: { min: 1, max: 10 },
      migrations: {
        migrationsList: [Migration20261107160000InitialFinancialSchema],
        tableName: 'mikro_orm_migrations',
        transactional: true,
        allOrNothing: true,
      },
    });
    await orm.migrator.up({ schema });

    const adapter = new MikroOrmFinancialTransactionAdapter(orm.em);
    createWallet = new CreateWallet(adapter);
    processWager = new ProcessWagerTransaction(adapter);
  }, 60_000);

  afterAll(async () => {
    if (orm) {
      await orm.em
        .getConnection()
        .execute(`drop schema if exists "${schema}" cascade`);
      await orm.close(true);
    }
  });

  it('creates OPENING, CREDIT ledger and outbox in the same transaction', async () => {
    const playerId = randomUUID();
    const wallet = await createWallet.execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    expect(wallet.balance.amount).toBe('100.00');
    expect(wallet.version).toBe(1);

    const [summary] = await orm.em
      .getConnection()
      .execute<Array<{ wagers: string; ledger: string; outbox: string }>>(
        `select
         (select count(*)::text from "${schema}".wager_transactions where wallet_id = ?) as wagers,
         (select count(*)::text from "${schema}".wallet_ledger_entries where wallet_id = ?) as ledger,
         (select count(*)::text from "${schema}".outbox_messages where payload->'data'->>'walletId' = ?) as outbox`,
        [wallet.id, wallet.id, wallet.id],
      );

    expect(summary).toEqual({ wagers: '1', ledger: '1', outbox: '2' });

    await expect(
      createWallet.execute({
        playerId,
        initialBalance: { amount: '1.00', currency: 'BRL' },
      }),
    ).rejects.toBeInstanceOf(WalletAlreadyExistsError);
  });

  it('persists BET, WIN and LOSS and replays the historical balance', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const base = {
      providerId: 'provider-integration',
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: randomUUID(),
      gameId: 'integration-game',
    } as const;
    const bet = {
      ...base,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'BET' as const,
      money: { amount: '25.00', currency: 'BRL' },
    };

    const betResult = await processWager.execute(bet);
    const winResult = await processWager.execute({
      ...base,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'WIN',
      money: { amount: '5.00', currency: 'BRL' },
    });
    const lossResult = await processWager.execute({
      ...base,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'LOSS',
      money: { amount: '3.00', currency: 'BRL' },
    });
    const replay = await processWager.execute(bet);

    expect(betResult.balance.amount).toBe('75.00');
    expect(winResult.balance.amount).toBe('80.00');
    expect(lossResult.balance.amount).toBe('80.00');
    expect(replay.balance.amount).toBe('75.00');
    expect(replay.idempotentReplay).toBe(true);

    await expect(
      processWager.execute({
        ...bet,
        money: { amount: '26.00', currency: 'BRL' },
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const [summary] = await orm.em
      .getConnection()
      .execute<Array<{ balance: string; debits: string; credits: string }>>(
        `select w.balance::text as balance,
              count(l.seq) filter (where l.direction = 'DEBIT')::text as debits,
              count(l.seq) filter (where l.direction = 'CREDIT')::text as credits
       from "${schema}".wallets w
       left join "${schema}".wallet_ledger_entries l on l.wallet_id = w.id
       where w.id = ?
       group by w.id`,
        [wallet.id],
      );

    expect(summary).toEqual({ balance: '80.00', debits: '1', credits: '2' });
  });
});
