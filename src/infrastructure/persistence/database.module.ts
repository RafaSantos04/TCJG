import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { createMikroOrmOptions } from './mikro-orm/mikro-orm.options.js';

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      imports: [ConfigModule],
      driver: PostgreSqlDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createMikroOrmOptions({
          clientUrl: config.getOrThrow<string>('DATABASE_URL'),
          poolMin: config.getOrThrow<number>('DB_POOL_MIN'),
          poolMax: config.getOrThrow<number>('DB_POOL_MAX'),
        }),
    }),
  ],
})
export class DatabaseModule {}
