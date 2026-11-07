import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallet_ledger_entries' })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ columnType: 'bigserial', autoincrement: true })
  seq!: string;

  @Property({ fieldName: 'wallet_id', columnType: 'uuid' })
  walletId!: string;

  @Property({ fieldName: 'transaction_id', columnType: 'uuid' })
  transactionId!: string;

  @Property({ columnType: 'varchar(10)' })
  direction!: string;

  @Property({ columnType: 'numeric(20,2)' })
  amount!: string;

  @Property({ columnType: 'char(3)' })
  currency!: string;

  @Property({ fieldName: 'balance_before', columnType: 'numeric(20,2)' })
  balanceBefore!: string;

  @Property({ fieldName: 'balance_after', columnType: 'numeric(20,2)' })
  balanceAfter!: string;

  @Property({ fieldName: 'created_at', columnType: 'timestamptz' })
  createdAt!: Date;
}
