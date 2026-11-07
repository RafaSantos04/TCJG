import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';

type DatabaseOptions = Readonly<{
  clientUrl: string;
  poolMin?: number;
  poolMax?: number;
}>;

export function createMikroOrmOptions({
  clientUrl,
  poolMin = 2,
  poolMax = 10,
}: DatabaseOptions) {
  return defineConfig({
    clientUrl,
    entities: ['./dist/**/*.entity.js'],
    entitiesTs: ['./src/**/*.entity.ts'],
    metadataProvider: ReflectMetadataProvider,
    extensions: [Migrator],
    pool: {
      min: poolMin,
      max: poolMax,
    },
    discovery: {
      warnWhenNoEntities: false,
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
