import 'reflect-metadata';
import {
  Entity,
  PrimaryKey,
  Property,
  ReflectMetadataProvider,
} from '@mikro-orm/decorators/legacy';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';

@Entity()
class DecoratedProbe {
  @PrimaryKey()
  id!: string;

  @Property()
  value!: string;
}

describe('MikroORM decorator metadata', () => {
  it('is discovered by MikroORM in the Bun test runner', async () => {
    expect(
      Reflect.getMetadata('design:type', DecoratedProbe.prototype, 'id'),
    ).toBe(String);
    expect(
      Reflect.getMetadata('design:type', DecoratedProbe.prototype, 'value'),
    ).toBe(String);

    const orm = new MikroORM({
      driver: PostgreSqlDriver,
      clientUrl: 'postgresql://metadata:metadata@localhost:5433/metadata',
      entities: [DecoratedProbe],
      metadataProvider: ReflectMetadataProvider,
    });

    try {
      const metadata = orm.getMetadata().get(DecoratedProbe);

      expect(metadata.properties.id.type).toBe('string');
      expect(metadata.properties.id.primary).toBe(true);
      expect(metadata.properties.value.type).toBe('string');
    } finally {
      await orm.close(true);
    }
  });
});
