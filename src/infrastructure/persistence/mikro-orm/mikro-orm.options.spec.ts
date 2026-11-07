import { MikroORM } from '@mikro-orm/postgresql';
import {
  createMikroOrmOptions,
  financialEntities,
} from './mikro-orm.options.js';

describe('MikroORM production options', () => {
  it('registers and discovers every persistence entity explicitly', async () => {
    const options = createMikroOrmOptions({
      clientUrl: 'postgresql://metadata:metadata@localhost:5433/metadata',
    });
    const orm = new MikroORM(options);

    try {
      expect(options.entities).toEqual(financialEntities);
      expect(options.entities).toHaveLength(5);
      expect([
        orm.getMetadata().get(financialEntities[0]).className,
        orm.getMetadata().get(financialEntities[1]).className,
        orm.getMetadata().get(financialEntities[2]).className,
        orm.getMetadata().get(financialEntities[3]).className,
        orm.getMetadata().get(financialEntities[4]).className,
      ]).toEqual([
        'WalletEntity',
        'WagerTransactionEntity',
        'WalletLedgerEntryEntity',
        'InboxMessageEntity',
        'OutboxMessageEntity',
      ]);
    } finally {
      await orm.close(true);
    }
  });
});
