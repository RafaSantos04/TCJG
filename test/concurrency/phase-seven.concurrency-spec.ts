import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migration20261107160000InitialFinancialSchema } from '../../src/infrastructure/persistence/mikro-orm/migrations/Migration20261107160000InitialFinancialSchema.js';
import { financialEntities } from '../../src/infrastructure/persistence/mikro-orm/mikro-orm.options.js';
import { expectWalletMatchesLedger } from '../helpers/financial-invariants.js';

type WalletResponse = Readonly<{
  id: string;
  playerId: string;
  balance: { amount: string; currency: string };
  version: number;
}>;

type WagerResponse = Readonly<{
  transactionId: string;
  status: 'PROCESSED' | 'REJECTED';
  failureCode?: string;
  balance: { amount: string; currency: string };
  idempotentReplay: boolean;
}>;

type WagerPayload = Readonly<{
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: 'BET' | 'WIN' | 'LOSS';
  money: { amount: string; currency: string };
}>;

const apiUrls = (
  process.env.CONCURRENCY_API_URLS ??
  'http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002'
)
  .split(',')
  .map((url) => url.trim().replace(/\/$/, ''));

async function post<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: (await response.json()) as T,
  };
}

describe.sequential('Phase 7 multi-instance financial concurrency', () => {
  let orm: Awaited<ReturnType<typeof MikroORM.init>>;

  beforeAll(async () => {
    expect(
      new Set(apiUrls).size,
      'CONCURRENCY_API_URLS must expose at least three distinct API instances',
    ).toBeGreaterThanOrEqual(3);
    const health = await Promise.all(
      apiUrls.slice(0, 3).map((url) => fetch(`${url}/health/live`)),
    );
    expect(health.every((response) => response.ok)).toBe(true);

    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      clientUrl:
        process.env.TEST_DATABASE_URL ??
        'postgresql://tcjg:tcjg@127.0.0.1:5433/tcjg',
      entities: financialEntities,
      metadataProvider: ReflectMetadataProvider,
      extensions: [Migrator],
      pool: { min: 1, max: 5 },
      migrations: {
        migrationsList: [Migration20261107160000InitialFinancialSchema],
        tableName: 'mikro_orm_migrations',
        transactional: true,
        allOrNothing: true,
      },
    });

    await orm.migrator.up();
  }, 60_000);

  afterAll(async () => {
    await orm.close(true);
  });

  const createWallet = async (amount = '100.00'): Promise<WalletResponse> => {
    const response = await post<WalletResponse>(apiUrls[0]!, '/wallets', {
      playerId: randomUUID(),
      initialBalance: { amount, currency: 'BRL' },
    });

    expect(
      response.status,
      `POST /wallets returned ${response.status}: ${JSON.stringify(response.body)}`,
    ).toBe(201);
    return response.body;
  };

  const payloadFor = (
    wallet: WalletResponse,
    input: Partial<WagerPayload> = {},
  ): WagerPayload => ({
    providerId: 'provider-phase-seven',
    externalTransactionId: randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: `round-${randomUUID()}`,
    gameId: 'concurrency-test',
    kind: 'BET',
    money: { amount: '10.00', currency: 'BRL' },
    ...input,
  });

  it('returns 409 when player and currency already have a wallet', async () => {
    const walletRequest = {
      playerId: randomUUID(),
      initialBalance: { amount: '10.00', currency: 'BRL' },
    };

    const first = await post<WalletResponse>(
      apiUrls[0]!,
      '/wallets',
      walletRequest,
    );
    const duplicate = await post<Record<string, unknown>>(
      apiUrls[1 % apiUrls.length]!,
      '/wallets',
      walletRequest,
    );

    expect(
      first.status,
      `POST /wallets returned ${first.status}: ${JSON.stringify(first.body)}`,
    ).toBe(201);
    expect(
      duplicate.status,
      `duplicate POST /wallets returned ${duplicate.status}: ${JSON.stringify(duplicate.body)}`,
    ).toBe(409);
    await expectWalletMatchesLedger(orm.em.getConnection(), first.body.id);
  });

  it('serializes two competing BETs without a lost update', async () => {
    const wallet = await createWallet();
    const payloads = [
      payloadFor(wallet, { money: { amount: '80.00', currency: 'BRL' } }),
      payloadFor(wallet, { money: { amount: '80.00', currency: 'BRL' } }),
    ];

    const responses = await Promise.all(
      payloads.map((payload, index) =>
        post<WagerResponse>(
          apiUrls[index % apiUrls.length]!,
          '/wagering/transactions',
          payload,
          `${payload.providerId}:${payload.externalTransactionId}`,
        ),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.status).sort()).toEqual([
      'PROCESSED',
      'REJECTED',
    ]);

    const [summary] = await orm.em
      .getConnection()
      .execute<Array<{ balance: string; debits: string }>>(
        `select w.balance::text as balance,
              count(l.seq) filter (where l.direction = 'DEBIT')::text as debits
       from wallets w
       left join wallet_ledger_entries l on l.wallet_id = w.id
       where w.id = ?
       group by w.id`,
        [wallet.id],
      );

    expect(summary).toEqual({ balance: '20.00', debits: '1' });
    await expectWalletMatchesLedger(orm.em.getConnection(), wallet.id);
  });

  it('deduplicates the same BET sent 50 times in parallel', async () => {
    const wallet = await createWallet();
    const payload = payloadFor(wallet, {
      money: { amount: '25.00', currency: 'BRL' },
    });
    const key = `${payload.providerId}:${payload.externalTransactionId}`;

    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        post<WagerResponse>(
          apiUrls[index % apiUrls.length]!,
          '/wagering/transactions',
          payload,
          key,
        ),
      ),
    );

    const failures = responses
      .map((response, index) => ({ index, ...response }))
      .filter((response) => response.status !== 200);
    expect(
      failures,
      `duplicate BET failures: ${JSON.stringify(failures)}`,
    ).toEqual([]);
    expect(
      new Set(responses.map((response) => response.body.transactionId)).size,
    ).toBe(1);
    expect(
      responses.filter((response) => !response.body.idempotentReplay),
    ).toHaveLength(1);

    const [summary] = await orm.em
      .getConnection()
      .execute<Array<{ balance: string; debits: string }>>(
        `select w.balance::text as balance,
              count(l.seq) filter (where l.direction = 'DEBIT')::text as debits
       from wallets w
       left join wallet_ledger_entries l on l.wallet_id = w.id
       where w.id = ?
       group by w.id`,
        [wallet.id],
      );

    expect(summary).toEqual({ balance: '75.00', debits: '1' });
    await expectWalletMatchesLedger(orm.em.getConnection(), wallet.id);
  });

  it('processes distinct wallets in parallel', async () => {
    const wallets = await Promise.all([createWallet(), createWallet()]);

    const responses = await Promise.all(
      wallets.map((wallet, index) => {
        const payload = payloadFor(wallet);
        return post<WagerResponse>(
          apiUrls[index % apiUrls.length]!,
          '/wagering/transactions',
          payload,
          `${payload.providerId}:${payload.externalTransactionId}`,
        );
      }),
    );

    expect(responses.map((response) => response.body.status)).toEqual([
      'PROCESSED',
      'PROCESSED',
    ]);
    await Promise.all(
      wallets.map((wallet) =>
        expectWalletMatchesLedger(orm.em.getConnection(), wallet.id),
      ),
    );
  });

  it('replays the balance observed at processing time', async () => {
    const wallet = await createWallet();
    const bet = payloadFor(wallet);
    const betKey = `${bet.providerId}:${bet.externalTransactionId}`;

    const first = await post<WagerResponse>(
      apiUrls[0]!,
      '/wagering/transactions',
      bet,
      betKey,
    );
    const win = payloadFor(wallet, {
      kind: 'WIN',
      money: { amount: '5.00', currency: 'BRL' },
    });
    await post<WagerResponse>(
      apiUrls[1 % apiUrls.length]!,
      '/wagering/transactions',
      win,
      `${win.providerId}:${win.externalTransactionId}`,
    );
    const replay = await post<WagerResponse>(
      apiUrls[2 % apiUrls.length]!,
      '/wagering/transactions',
      bet,
      betKey,
    );

    expect(first.body.balance.amount).toBe('90.00');
    expect(replay.body.balance.amount).toBe('90.00');
    expect(replay.body.idempotentReplay).toBe(true);
    await expectWalletMatchesLedger(orm.em.getConnection(), wallet.id);
  });

  it('returns 409 when an idempotency key is reused with another payload', async () => {
    const wallet = await createWallet();
    const original = payloadFor(wallet);
    const key = `${original.providerId}:${original.externalTransactionId}`;

    await post<WagerResponse>(
      apiUrls[0]!,
      '/wagering/transactions',
      original,
      key,
    );
    const conflict = await post<Record<string, unknown>>(
      apiUrls[1 % apiUrls.length]!,
      '/wagering/transactions',
      {
        ...original,
        money: { amount: '11.00', currency: 'BRL' },
      },
      key,
    );

    expect(conflict.status).toBe(409);
    await expectWalletMatchesLedger(orm.em.getConnection(), wallet.id);
  });
});
