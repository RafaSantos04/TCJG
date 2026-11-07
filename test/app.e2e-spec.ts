import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestNodeApplication, NodeAdapter } from '@nestjs/platform-node';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { DatabaseModule } from './../src/infrastructure/persistence/database.module.js';
import { FINANCIAL_TRANSACTION_PORT } from './../src/shared/application/ports/financial-transaction.port.js';

@Module({})
class TestDatabaseModule {}

describe('AppController (e2e)', () => {
  let app: NestNodeApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .overrideProvider(FINANCIAL_TRANSACTION_PORT)
      .useValue({ run: vi.fn() })
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

  afterEach(async () => {
    await app.close();
  });
});
