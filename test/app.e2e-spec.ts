import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NestNodeApplication, NodeAdapter } from '@nestjs/platform-node';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { DatabaseModule } from './../src/infrastructure/persistence/database.module.js';

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

  afterEach(async () => {
    await app.close();
  });
});
