import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import { InboxMessageEntity } from './entities/inbox-message.entity.js';
import { OutboxMessageEntity } from './entities/outbox-message.entity.js';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity.js';
import { WalletEntity } from './entities/wallet.entity.js';

type DatabaseOptions = Readonly<{
  clientUrl: string;
  poolMin?: number;
  poolMax?: number;
}>;

export const financialEntities = [
  WalletEntity,
  WagerTransactionEntity,
  WalletLedgerEntryEntity,
  InboxMessageEntity,
  OutboxMessageEntity,
] as const;

export function createMikroOrmOptions({
  clientUrl,
  poolMin = 2,
  poolMax = 10,
}: DatabaseOptions) {
  return defineConfig({
    clientUrl,
    entities: financialEntities,
    metadataProvider: ReflectMetadataProvider,
    extensions: [Migrator],
    pool: {
      min: poolMin,
      max: poolMax,
    },
    migrations: {
      tableName: 'mikro_orm_migrations',
      path: './dist/infrastructure/persistence/mikro-orm/migrations',
      pathTs: './src/infrastructure/persistence/mikro-orm/migrations',
      transactional: true,
      allOrNothing: true,
      emit: 'ts',
    },
  });
}
