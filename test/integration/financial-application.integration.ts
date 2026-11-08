import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Mock } from 'vitest';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';
import { MikroOrmFinancialTransactionAdapter } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm-financial-transaction.adapter.js';
import { MikroOrmFinancialQueryAdapter } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm-financial-query.adapter.js';
import { Migration20261107160000InitialFinancialSchema } from '../../src/infrastructure/persistence/mikro-orm/migrations/Migration20261107160000InitialFinancialSchema.js';
import { financialEntities } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm.options.js';
import { CreateWallet } from '../../src/wallet/application/create-wallet.js';
import { GetWallet } from '../../src/wallet/application/get-wallet.js';
import { ListWalletLedger } from '../../src/wallet/application/list-wallet-ledger.js';
import { WalletAlreadyExistsError } from '../../src/wallet/application/errors/wallet-already-exists.error.js';
import { IdempotencyConflictError } from '../../src/wagering/application/errors/idempotency-conflict.error.js';
import { ProcessWagerTransaction } from '../../src/wagering/application/process-wager-transaction.js';
import { GetWagerTransaction } from '../../src/wagering/application/get-wager-transaction.js';
import { MikroOrmPendingReferenceRepository } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm-pending-reference.repository.js';
import { ProcessPendingReferences } from '../../src/wagering/application/process-pending-references.js';
import type { ReconciliationObservabilityPort } from '../../src/shared/application/ports/reconciliation-observability.port.js';
import { ReconcileWallet } from '../../src/wallet/application/reconcile-wallet.js';
import { expectWalletMatchesLedger } from '../helpers/financial-invariants.js';

describe.sequential('financial application with PostgreSQL', () => {
  const schema = `phase_seven_${randomUUID().replaceAll('-', '')}`;
  let orm: Awaited<ReturnType<typeof MikroORM.init>>;
  let createWallet: CreateWallet;
  let processWager: ProcessWagerTransaction;
  let getWallet: GetWallet;
  let listWalletLedger: ListWalletLedger;
  let getWager: GetWagerTransaction;
  let processPendingReferences: ProcessPendingReferences;
  let reconcileWallet: ReconcileWallet;
  let reconciliationRecordDivergence: Mock<
    ReconciliationObservabilityPort['recordDivergence']
  >;

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
    const queryAdapter = new MikroOrmFinancialQueryAdapter(orm.em);
    createWallet = new CreateWallet(adapter);
    const pendingConfig = new ConfigService({
      PENDING_REFERENCE_INITIAL_DELAY_MS: 0,
      PENDING_REFERENCE_BATCH_SIZE: 10,
      PENDING_REFERENCE_LEASE_MS: 1_000,
      PENDING_REFERENCE_RETRY_BASE_MS: 1,
      PENDING_REFERENCE_RETRY_MAX_MS: 10,
      PENDING_REFERENCE_MAX_ATTEMPTS: 1,
    });
    processWager = new ProcessWagerTransaction(adapter, pendingConfig);
    processPendingReferences = new ProcessPendingReferences(
      new MikroOrmPendingReferenceRepository(orm.em),
      processWager,
      pendingConfig,
    );
    getWallet = new GetWallet(queryAdapter);
    listWalletLedger = new ListWalletLedger(queryAdapter);
    getWager = new GetWagerTransaction(queryAdapter);
    reconciliationRecordDivergence = vi.fn<
      ReconciliationObservabilityPort['recordDivergence']
    >();
    const reconciliationObservability: ReconciliationObservabilityPort = {
      recordDivergence: reconciliationRecordDivergence,
    };
    reconcileWallet = new ReconcileWallet(
      queryAdapter,
      reconciliationObservability,
    );
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

  it('queries wallet, wager and stable ledger pages around a new insert', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const base = {
      providerId: 'provider-query-integration',
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: randomUUID(),
      gameId: 'query-game',
    } as const;
    const externalTransactionId = randomUUID();
    const bet = await processWager.execute({
      ...base,
      externalTransactionId,
      idempotencyKey: randomUUID(),
      kind: 'BET',
      money: { amount: '10.00', currency: 'BRL' },
    });

    const firstPage = await listWalletLedger.execute({
      walletId: wallet.id,
      limit: 1,
    });
    await processWager.execute({
      ...base,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'WIN',
      money: { amount: '5.00', currency: 'BRL' },
    });
    const secondPage = await listWalletLedger.execute({
      walletId: wallet.id,
      cursor: firstPage.nextCursor ?? undefined,
      limit: 2,
    });

    expect((await getWallet.execute(wallet.id)).balance.amount).toBe('95.00');
    expect((await getWager.byId(bet.transactionId)).id).toBe(bet.transactionId);
    expect(
      (await getWager.byProvider(base.providerId, externalTransactionId)).id,
    ).toBe(bet.transactionId);
    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(2);
    expect(
      new Set([
        ...firstPage.items.map((item) => item.sequence),
        ...secondPage.items.map((item) => item.sequence),
      ]).size,
    ).toBe(3);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('reconciles a consistent wallet from a repeatable-read snapshot', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    await processWager.execute({
      providerId: 'provider-reconciliation',
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: randomUUID(),
      gameId: 'reconciliation-game',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    });

    await expectWalletMatchesLedger(orm.em.getConnection(), wallet.id, schema);
    await expect(reconcileWallet.execute(wallet.id)).resolves.toEqual({
      walletId: wallet.id,
      storedBalance: { amount: '75.00', currency: 'BRL' },
      calculatedBalance: { amount: '75.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
  });

  it('detects a forced stored-balance divergence without correcting it', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    await orm.em
      .getConnection()
      .execute(
        `update "${schema}".wallets set balance = '125.00' where id = ?`,
        [wallet.id],
      );

    const result = await reconcileWallet.execute(wallet.id);

    expect(result).toEqual({
      walletId: wallet.id,
      storedBalance: { amount: '125.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      difference: { amount: '25.00', currency: 'BRL' },
      consistent: false,
      checkedEntries: 1,
    });
    expect(reconciliationRecordDivergence).toHaveBeenCalledOnce();
    const [persisted] = await orm.em
      .getConnection()
      .execute<Array<{ balance: string }>>(
        `select balance::text as balance from "${schema}".wallets where id = ?`,
        [wallet.id],
      );
    expect(persisted?.balance).toBe('125.00');
  });

  it('resolves a ROLLBACK that arrived before its BET', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const roundId = randomUUID();
    const providerId = 'provider-out-of-order';
    const betExternalId = randomUUID();
    const pending = await processWager.execute({
      providerId,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId,
      gameId: 'out-of-order-game',
      kind: 'ROLLBACK',
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: betExternalId,
    });
    expect(pending.status).toBe('PENDING_REFERENCE');

    await processWager.execute({
      providerId,
      externalTransactionId: betExternalId,
      idempotencyKey: randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId,
      gameId: 'out-of-order-game',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    });
    const stats = await processPendingReferences.runOnce();
    const resolved = await getWager.byId(pending.transactionId);

    expect(stats.processed).toBe(1);
    expect(resolved.status).toBe('PROCESSED');
    expect(resolved.balanceAfter?.amount).toBe('100.00');
    expect((await getWallet.execute(wallet.id)).balance.amount).toBe('100.00');
  });

  it('rejects PENDING_REFERENCE when the retry limit is exhausted', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const pending = await processWager.execute({
      providerId: 'provider-missing-reference',
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: randomUUID(),
      gameId: 'missing-reference-game',
      kind: 'REFUND',
      money: { amount: '10.00', currency: 'BRL' },
      referenceExternalTransactionId: randomUUID(),
    });

    const stats = await processPendingReferences.runOnce();
    const rejected = await getWager.byId(pending.transactionId);

    expect(stats.rejected).toBe(1);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.failureCode).toBe('REFERENCE_NOT_FOUND');
  });

  it('rejects a second REFUND of the same BET as ALREADY_REVERSED', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const base = {
      providerId: 'provider-double-refund',
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: randomUUID(),
      gameId: 'double-refund-game',
      money: { amount: '25.00', currency: 'BRL' },
    } as const;
    const betExternalId = randomUUID();
    await processWager.execute({
      ...base,
      externalTransactionId: betExternalId,
      idempotencyKey: randomUUID(),
      kind: 'BET',
    });
    await processWager.execute({
      ...base,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'REFUND',
      referenceExternalTransactionId: betExternalId,
    });
    const duplicate = await processWager.execute({
      ...base,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'REFUND',
      referenceExternalTransactionId: betExternalId,
    });

    expect(duplicate.status).toBe('REJECTED');
    expect(duplicate.failureCode).toBe('ALREADY_REVERSED');
    expect(duplicate.balance.amount).toBe('100.00');
  });

  it('distinguishes reversal insufficient funds from a rejected BET', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '10.00', currency: 'BRL' },
    });
    const base = {
      providerId: 'provider-reversal-funds',
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: randomUUID(),
      gameId: 'reversal-funds-game',
      money: { amount: '25.00', currency: 'BRL' },
    } as const;
    const winExternalId = randomUUID();
    await processWager.execute({
      ...base,
      externalTransactionId: winExternalId,
      idempotencyKey: randomUUID(),
      kind: 'WIN',
    });
    await processWager.execute({
      ...base,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'BET',
    });
    const rollback = await processWager.execute({
      ...base,
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: 'ROLLBACK',
      referenceExternalTransactionId: winExternalId,
    });

    expect(rollback.status).toBe('REJECTED');
    expect(rollback.failureCode).toBe('REVERSAL_INSUFFICIENT_FUNDS');
    expect(rollback.balance.amount).toBe('10.00');
  });
});
