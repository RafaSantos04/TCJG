import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_messages' })
export class InboxMessageEntity {
  @PrimaryKey({ fieldName: 'consumer_name', columnType: 'varchar(255)' })
  consumerName!: string;

  @PrimaryKey({ fieldName: 'message_id', columnType: 'varchar(255)' })
  messageId!: string;

  @Property({ fieldName: 'payload_hash', columnType: 'char(64)' })
  payloadHash!: string;

  @Property({ fieldName: 'received_at', columnType: 'timestamptz' })
  receivedAt!: Date;

  @Property({
    fieldName: 'processed_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  processedAt?: Date;
}
