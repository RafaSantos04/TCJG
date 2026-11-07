import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/postgresql';

@Entity({ tableName: 'phase_one_persistence_probe' })
class PersistenceProbe {
  @PrimaryKey()
  readonly id: string;

  @Property()
  readonly value: string;

  constructor(id: string, value: string) {
    this.id = id;
    this.value = value;
  }
}

describe('MikroORM on Bun', () => {
  it('persists and reloads a decorated entity in real PostgreSQL', async () => {
    const bunVersion = (
      process.versions as NodeJS.ProcessVersions & { bun?: string }
    ).bun;

    expect(bunVersion).toBeDefined();

    const orm = await MikroORM.init({
      clientUrl:
        process.env.TEST_DATABASE_URL ??
        'postgresql://tcjg:tcjg@localhost:5433/tcjg',
      entities: [PersistenceProbe],
      metadataProvider: ReflectMetadataProvider,
      pool: { min: 1, max: 1 },
    });

    try {
      await orm.em.transactional(async (entityManager) => {
        await entityManager.getConnection().execute(`
          create temporary table "phase_one_persistence_probe" (
            "id" varchar(255) not null,
            "value" varchar(255) not null,
            constraint "phase_one_persistence_probe_pkey" primary key ("id")
          ) on commit drop
        `);

        const id = randomUUID();
        const expectedValue = 'mikro-orm-on-bun';
        const probe = new PersistenceProbe(id, expectedValue);

        entityManager.persist(probe);
        await entityManager.flush();
        entityManager.clear();

        const persisted = await entityManager.findOneOrFail(PersistenceProbe, {
          id,
        });

        expect(persisted.value).toBe(expectedValue);
      });
    } finally {
      await orm.close(true);
    }
  });
});
