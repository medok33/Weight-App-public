import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('RP2-01B migrations 175-177', () => {
  it('creates CulinaryRole + ProductCulinaryRole', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/175_culinary-roles/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "CulinaryRole"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ProductCulinaryRole"');
    expect(sql).toContain('MAIN_PROTEIN');
    expect(sql).toContain('ProductCulinaryRole_one_primary_uidx');
  });

  it('creates ProductSubstitution with self-edge and ratio constraints', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/176_product-substitution/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ProductSubstitution"');
    expect(sql).toContain('ProductSubstitution_no_self');
    expect(sql).toContain('CookingMethod');
    expect(sql).toContain('NULLS NOT DISTINCT');
  });

  it('creates RetailProduct and PriceObservation.retailProductId', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/177_retail-product/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "RetailProduct"');
    expect(sql).toContain('retailProductId');
    expect(sql).toContain('NEEDS_PRODUCT_MAPPING');
    expect(sql).toContain('ON DELETE RESTRICT');
  });
});
