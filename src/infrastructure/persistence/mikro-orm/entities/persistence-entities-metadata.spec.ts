import 'reflect-metadata';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { InboxMessageEntity } from './inbox-message.entity.js';
import { OutboxMessageEntity } from './outbox-message.entity.js';
import { WagerTransactionEntity } from './wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from './wallet-ledger-entry.entity.js';
import { WalletEntity } from './wallet.entity.js';

const entities = [
  WalletEntity,
  WagerTransactionEntity,
  WalletLedgerEntryEntity,
  InboxMessageEntity,
  OutboxMessageEntity,
];

describe('financial persistence metadata', () => {
  it('discovers every entity and keeps monetary properties as strings', async () => {
    const orm = new MikroORM({
      driver: PostgreSqlDriver,
      clientUrl: 'postgresql://metadata:metadata@localhost:5433/metadata',
      entities,
      metadataProvider: ReflectMetadataProvider,
    });

    try {
      const walletMetadata = orm.getMetadata().get(WalletEntity);
      const wagerMetadata = orm.getMetadata().get(WagerTransactionEntity);
      const ledgerMetadata = orm.getMetadata().get(WalletLedgerEntryEntity);
      const inboxMetadata = orm.getMetadata().get(InboxMessageEntity);
      const outboxMetadata = orm.getMetadata().get(OutboxMessageEntity);

      expect(walletMetadata.class).toBe(WalletEntity);
      expect(wagerMetadata.class).toBe(WagerTransactionEntity);
      expect(ledgerMetadata.class).toBe(WalletLedgerEntryEntity);
      expect(inboxMetadata.class).toBe(InboxMessageEntity);
      expect(outboxMetadata.class).toBe(OutboxMessageEntity);

      expect(walletMetadata.properties.balance.runtimeType).toBe('string');
      expect(wagerMetadata.properties.amount.runtimeType).toBe('string');
      expect(wagerMetadata.properties.balanceAfter.runtimeType).toBe('string');
      expect(ledgerMetadata.properties.amount.runtimeType).toBe('string');
      expect(ledgerMetadata.properties.balanceBefore.runtimeType).toBe(
        'string',
      );
      expect(ledgerMetadata.properties.balanceAfter.runtimeType).toBe('string');
      expect(inboxMetadata.compositePK).toBe(true);
    } finally {
      await orm.close(true);
    }
  });
});
