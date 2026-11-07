import { createMikroOrmOptions } from './src/infrastructure/persistence/mikro-orm/mikro-orm.options.js';

export default createMikroOrmOptions({
  clientUrl:
    process.env.DATABASE_URL ?? 'postgresql://tcjg:tcjg@localhost:5433/tcjg',
  poolMin: Number(process.env.DB_POOL_MIN ?? 2),
  poolMax: Number(process.env.DB_POOL_MAX ?? 10),
});
