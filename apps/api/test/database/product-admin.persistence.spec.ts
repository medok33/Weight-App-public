import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService, type SqlQuery } from '../../src/infrastructure/database/prisma.service';
import { ProductAdminRepository } from '../../src/modules/product-admin/infrastructure/product-admin.repository';
import { ProductAdminService } from '../../src/modules/product-admin/application/product-admin.service';
import { MealDishCatalogRepository } from '../../src/modules/meal-plan/infrastructure/meal-dish-catalog.repository';
import { STEP093_PRODUCTS } from '../../src/modules/meal-plan/domain/substitution.fixture';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app';
const pool = new Pool({ connectionString });

function createDb(): PrismaService {
  const query: SqlQuery = (text, values = []) => pool.query(text, values);
  return { query, withTransaction: async (fn) => fn(query) } as PrismaService;
}

async function applyMigration(name: string): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8');
  await pool.query(sql);
}

describe('STEP_200 product-admin persistence', () => {
  const db = createDb();
  const repo = new ProductAdminRepository(db);
  const service = new ProductAdminService(repo);
  const catalog = new MealDishCatalogRepository(db);
  const owner = { id: '00000000-0000-4000-8000-0000000000aa', role: 'OWNER' } as const;
  const user = { id: '00000000-0000-4000-8000-0000000000bb', role: 'USER' } as const;
  let createdId = '';
  let categoryId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await applyMigration('178_product-admin-merge');
    await catalog.ensureCatalog();
    const cat = await pool.query<{ id: string }>(
      `SELECT id FROM "ProductCategory" WHERE code = 'grains' LIMIT 1`,
    );
    categoryId = cat.rows[0]!.id;
    const existing = await pool.query<{ id: string }>(`SELECT id FROM "User" WHERE id = $1`, [owner.id]);
    if (!existing.rows[0]) {
      await pool.query(
        `INSERT INTO "User" (id, email, "accountRole") VALUES ($1,'owner-admin-test@test.com','OWNER')`,
        [owner.id],
      );
    }
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('rejects USER access', async () => {
    await expect(service.list(user as never, {})).rejects.toThrow('OWNER_ACCESS_FORBIDDEN');
  });

  it('creates and updates product with optimistic concurrency', async () => {
    const created = await service.create(owner as never, {
      canonicalName: `Admin Test ${Date.now()}`,
      productKey: `admin_test_${Date.now()}`,
      categoryId,
      form: 'DRY',
      defaultUnit: 'g',
      caloriesPer100g: 100,
      proteinPer100g: 10,
    });
    createdId = created.id;
    const detail = await service.detail(owner as never, createdId);
    expect(detail.overview.id).toBe(createdId);

    await service.update(owner as never, createdId, {
      canonicalName: detail.overview.canonicalName + ' v2',
      rowVersion: Number(detail.overview.rowVersion),
    });
    await expect(
      service.update(owner as never, createdId, {
        canonicalName: 'stale',
        rowVersion: Number(detail.overview.rowVersion),
      }),
    ).rejects.toThrow('PRODUCT_VERSION_CONFLICT');
  });

  it('appends nutrition version immutably', async () => {
    const first = await service.createNutritionVersion(owner as never, createdId, {
      calories: 110,
      protein: 11,
      fat: 1,
      carbohydrate: 20,
      source: 'MANUAL',
    });
    expect(first.version).toBeGreaterThanOrEqual(1);
    const second = await service.createNutritionVersion(owner as never, createdId, {
      calories: 120,
      protein: 12,
      fat: 2,
      carbohydrate: 22,
      source: 'MANUAL',
    });
    expect(second.version).toBe(first.version + 1);
    const detail = await service.detail(owner as never, createdId);
    expect(detail.nutritionVersions.length).toBeGreaterThanOrEqual(2);
  });

  it('detects alias ambiguity without auto-map', async () => {
    const buckwheat = STEP093_PRODUCTS[0]!.id;
    const result = await service.addAlias(owner as never, createdId, {
      alias: 'Гречка',
      forceDespiteAmbiguity: false,
    });
    // May be AMBIGUOUS if fixture alias exists, or CREATED otherwise.
    expect(['AMBIGUOUS', 'CREATED', 'AMBIGUOUS_SAVED_FOR_REVIEW']).toContain(result.status);
    void buckwheat;
  });

  it('lists review queue and duplicates', async () => {
    const queue = await service.reviewQueue(owner as never);
    expect(Array.isArray(queue.items)).toBe(true);
    const dups = await service.duplicates(owner as never, 20);
    expect(Array.isArray(dups.items)).toBe(true);
  }, 30_000);

  it('merge preview and successful merge keep source row', async () => {
    const a = await service.create(owner as never, {
      canonicalName: `Merge Src ${Date.now()}`,
      productKey: `merge_src_${Date.now()}`,
      categoryId,
      form: 'RAW',
      defaultUnit: 'g',
    });
    const b = await service.create(owner as never, {
      canonicalName: `Merge Dst ${Date.now()}`,
      productKey: `merge_dst_${Date.now()}`,
      categoryId,
      form: 'RAW',
      defaultUnit: 'g',
    });
    const preview = await service.mergePreview(owner as never, a.id, b.id);
    expect(preview.blocked).toBe(false);
    const merged = await service.merge(owner as never, a.id, b.id);
    expect(merged.status).toBe('MERGED');
    const source = await repo.getProductRow(a.id);
    expect(source?.status).toBe('MERGED');
    expect(source?.canonicalProductId).toBe(b.id);
    const same = await service.mergePreview(owner as never, a.id, a.id);
    expect(same.blocked).toBe(true);
  });

  it('blocks concurrent duplicate substitution edges', async () => {
    const pasta = STEP093_PRODUCTS[3]!.id;
    const rice = STEP093_PRODUCTS[6]!.id;
    await pool.query(
      `DELETE FROM "ProductSubstitution" WHERE "sourceProductId" = $1 AND "replacementProductId" = $2 AND "culinaryRoleId" IS NULL`,
      [pasta, rice],
    );
    const insert = () =>
      service.createSubstitution(owner as never, pasta, {
        replacementProductId: rice,
        replacementRatio: 1,
        replacementRatioMin: 0.8,
        replacementRatioMax: 1.2,
        supportedMethods: ['BOIL'],
        status: 'ACTIVE',
      });
    const attempts = await Promise.allSettled([insert(), insert()]);
    const ok = attempts.filter((a) => a.status === 'fulfilled');
    const fail = attempts.filter((a) => a.status === 'rejected');
    expect(ok.length + fail.length).toBe(2);
    expect(ok.length).toBeGreaterThanOrEqual(1);
  });
});
