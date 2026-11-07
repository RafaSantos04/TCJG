import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestNodeApplication, NodeAdapter } from '@nestjs/platform-node';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { DatabaseModule } from './../src/infrastructure/persistence/database.module.js';
import { FINANCIAL_TRANSACTION_PORT } from './../src/shared/application/ports/financial-transaction.port.js';
import { FINANCIAL_QUERY_PORT } from './../src/shared/application/ports/financial-query.port.js';
import { TransientPersistenceError } from './../src/shared/application/errors/persistence.error.js';
import { CreateWallet } from './../src/wallet/application/create-wallet.js';
import { IdempotencyConflictError } from './../src/wagering/application/errors/idempotency-conflict.error.js';
import { ProcessWagerTransaction } from './../src/wagering/application/process-wager-transaction.js';

@Module({})
class TestDatabaseModule {}

let transactionSequence = 0;
function transactionId(): string {
  transactionSequence += 1;
  return `0192f298-345e-7e38-af88-e43f851a8${transactionSequence
    .toString()
    .padStart(3, '0')}`;
}

describe('AppController (e2e)', () => {
  let app: NestNodeApplication;
  const walletId = '0192f291-27dd-7d3f-8071-5f8685deef37';
  const playerId = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
  const queryPort = {
    findWallet: vi.fn(async (id: string) =>
      id === walletId
        ? {
            id: walletId,
            playerId,
            balance: { amount: '100.00', currency: 'BRL' },
            version: 1,
            createdAt: new Date('2026-11-07T18:00:00.000Z'),
            updatedAt: new Date('2026-11-07T18:00:00.000Z'),
          }
        : undefined,
    ),
    listWalletLedger: vi.fn(async () => []),
    findWagerById: vi.fn(async () => undefined),
    findWagerByProviderTransaction: vi.fn(async () => undefined),
  };
  const createWalletUseCase = { execute: vi.fn() };
  const processWagerUseCase = { execute: vi.fn() };
  const validWagerRequest = {
    providerId: 'provider-a',
    externalTransactionId: 'transaction-a',
    playerId,
    walletId,
    roundId: 'round-a',
    gameId: 'game-a',
    kind: 'BET',
    money: { amount: '10.00', currency: 'BRL' },
  } as const;

  beforeEach(async () => {
    vi.clearAllMocks();
    createWalletUseCase.execute.mockResolvedValue({
      id: walletId,
      playerId,
      balance: { amount: '100.00', currency: 'BRL' },
      version: 1,
    });
    processWagerUseCase.execute.mockResolvedValue({
      transactionId: transactionId(),
      status: 'PROCESSED',
      balance: { amount: '90.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .overrideProvider(FINANCIAL_TRANSACTION_PORT)
      .useValue({ run: vi.fn() })
      .overrideProvider(FINANCIAL_QUERY_PORT)
      .useValue(queryPort)
      .overrideProvider(CreateWallet)
      .useValue(createWalletUseCase)
      .overrideProvider(ProcessWagerTransaction)
      .useValue(processWagerUseCase)
      .compile();

    app = moduleFixture.createNestApplication<NestNodeApplication>(
      new NodeAdapter(),
    );
    await app.init();
  });

  it('/ (GET)', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ name: 'tcjg', status: 'ok' });
  });

  it('rejects a wagering request without an Idempotency-Key', async () => {
    await request(app.getHttpServer())
      .post('/wagering/transactions')
      .send({
        providerId: 'provider-a',
        externalTransactionId: 'transaction-a',
        playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        roundId: 'round-a',
        gameId: 'game-a',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      })
      .expect(422);
  });

  it('returns 201 when a wallet is created', async () => {
    await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      })
      .expect(201);
  });

  it('returns 200 for processed, rejected and idempotent replay results', async () => {
    processWagerUseCase.execute
      .mockResolvedValueOnce({
        transactionId: transactionId(),
        status: 'PROCESSED',
        balance: { amount: '90.00', currency: 'BRL' },
        idempotentReplay: false,
      })
      .mockResolvedValueOnce({
        transactionId: transactionId(),
        status: 'REJECTED',
        failureCode: 'INSUFFICIENT_FUNDS',
        balance: { amount: '90.00', currency: 'BRL' },
        idempotentReplay: false,
      })
      .mockResolvedValueOnce({
        transactionId: transactionId(),
        status: 'PROCESSED',
        balance: { amount: '90.00', currency: 'BRL' },
        idempotentReplay: true,
      });

    for (const key of ['processed', 'rejected', 'replay']) {
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', key)
        .send({ ...validWagerRequest, externalTransactionId: key })
        .expect(200);
    }
  });

  it('returns 202 when a transaction is waiting for its reference', async () => {
    processWagerUseCase.execute.mockResolvedValueOnce({
      transactionId: transactionId(),
      status: 'PENDING_REFERENCE',
      balance: { amount: '90.00', currency: 'BRL' },
      idempotentReplay: false,
    });

    await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'pending-reference')
      .send(validWagerRequest)
      .expect(202);
  });

  it('returns 409 for an idempotency conflict', async () => {
    processWagerUseCase.execute.mockRejectedValueOnce(
      new IdempotencyConflictError('conflicting-key'),
    );

    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'conflicting-key')
      .send(validWagerRequest)
      .expect(409);

    expect(response.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects OPENING submitted through the external API', async () => {
    await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:opening')
      .send({
        providerId: 'provider-a',
        externalTransactionId: 'opening',
        playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        roundId: 'round-a',
        gameId: 'game-a',
        kind: 'OPENING',
        money: { amount: '10.00', currency: 'BRL' },
      })
      .expect(422);
  });

  it('returns a wallet through the read API', async () => {
    await request(app.getHttpServer())
      .get(`/wallets/${walletId}`)
      .expect(200)
      .expect({
        id: walletId,
        playerId,
        balance: { amount: '100.00', currency: 'BRL' },
        version: 1,
        createdAt: '2026-11-07T18:00:00.000Z',
        updatedAt: '2026-11-07T18:00:00.000Z',
      });
  });

  it('maps a missing wallet to the standard 404 body', async () => {
    const response = await request(app.getHttpServer())
      .get('/wallets/0192f291-27dd-7d3f-8071-5f8685deef38')
      .expect(404);

    expect(response.body).toEqual({
      error: {
        code: 'WALLET_NOT_FOUND',
        message: 'Wallet 0192f291-27dd-7d3f-8071-5f8685deef38 was not found',
        retryable: false,
      },
    });
  });

  it('maps malformed route input to the standard 422 body', async () => {
    const response = await request(app.getHttpServer())
      .get('/wallets/not-a-uuid')
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false,
    });
  });

  it('maps an invalid ledger cursor to 422', async () => {
    const response = await request(app.getHttpServer())
      .get(`/wallets/${walletId}/ledger?cursor=not%20base64!`)
      .expect(422);

    expect(response.body).toEqual({
      error: {
        code: 'INVALID_LEDGER_CURSOR',
        message: 'Ledger cursor is invalid',
        retryable: false,
      },
    });
  });

  it('maps transient persistence errors to retryable 503', async () => {
    queryPort.findWallet.mockRejectedValueOnce(
      new TransientPersistenceError('Database is temporarily unavailable'),
    );

    const response = await request(app.getHttpServer())
      .get(`/wallets/${walletId}`)
      .expect('Retry-After', '1')
      .expect(503);

    expect(response.body).toEqual({
      error: {
        code: 'TRANSIENT_PERSISTENCE_FAILURE',
        message: 'Database is temporarily unavailable',
        retryable: true,
      },
    });
  });

  afterEach(async () => {
    await app?.close();
  });
});
