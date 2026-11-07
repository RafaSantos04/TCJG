import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallets' })
export class WalletEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id!: string;

  @Property({ fieldName: 'player_id', columnType: 'uuid' })
  playerId!: string;

  @Property({ columnType: 'numeric(20,2)' })
  balance!: string;

  @Property({ columnType: 'char(3)' })
  currency!: string;

  @Property({ columnType: 'integer' })
  version!: number;

  @Property({ fieldName: 'created_at', columnType: 'timestamptz' })
  createdAt!: Date;

  @Property({ fieldName: 'updated_at', columnType: 'timestamptz' })
  updatedAt!: Date;
}
