import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RP2-01A migrations 171-174 contract', () => {
  it('171 creates ProductCategory taxonomy and form fields', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/171_product-category-and-form/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ProductCategory"');
    expect(sql).toContain('UNCLASSIFIED');
    expect(sql).toContain('"form"');
    expect(sql).toContain('product_category_assert_acyclic');
  });

  it('172 normalizes ProductAlias', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/172_product-alias-normalization/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('"normalizedAlias"');
    expect(sql).toContain('ProductAlias_productId_normalizedAlias_uidx');
  });

  it('173 versions nutrition and makes it immutable', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/173_product-nutrition-version/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('ProductNutritionVersion');
    expect(sql).toContain('LEGACY_BACKFILL');
    expect(sql).toContain('PRODUCT_NUTRITION_VERSION_IMMUTABLE');
  });

  it('174 normalizes allergens and dietary tags', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/174_product-allergen-dietary/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "Allergen"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "DietaryTag"');
    expect(sql).toContain('CROSS_CONTAMINATION_RISK');
  });
});
