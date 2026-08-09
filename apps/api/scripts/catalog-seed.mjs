#!/usr/bin/env node
/**
 * Catalog seed CLI — RP2-01C2
 * Usage:
 *   pnpm catalog:seed:check -- --dataset=catalog-core-v2
 *   pnpm catalog:seed:dry-run -- --dataset=catalog-core-v2
 *   pnpm catalog:seed:apply -- --dataset=catalog-core-v2
 *   pnpm catalog:seed:report -- --dataset=catalog-core-v2
 *
 * Apply requires CATALOG_SEED_CONFIRM=1 (or --confirm).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildPilotManifest } from '../src/modules/product-catalog/seed/pilot-v1.dataset.ts';
import { buildCatalogCoreV2Manifest } from '../src/modules/product-catalog/seed/catalog-core-v2.dataset.ts';
import { buildCatalogCoreV3Manifest } from '../src/modules/product-catalog/seed/catalog-core-v3.dataset.ts';
import { runCatalogSeed } from '../src/modules/product-catalog/seed/apply-engine.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const modeArg = args.find((a) => !a.startsWith('-')) ?? 'check';
const mode =
  modeArg === 'dry-run' || modeArg === 'apply' || modeArg === 'report' || modeArg === 'check'
    ? modeArg
    : null;

const datasetArg =
  args.find((a) => a.startsWith('--dataset='))?.slice('--dataset='.length) ??
  process.env.CATALOG_SEED_DATASET ??
  'catalog-core-v3';

const confirmed =
  args.includes('--confirm') ||
  process.env.CATALOG_SEED_CONFIRM === '1' ||
  process.env.CATALOG_SEED_CONFIRM === 'true';

if (!mode) {
  console.error('Usage: catalog-seed.mjs <check|dry-run|apply|report> [--dataset=catalog-core-v3] [--confirm]');
  process.exit(1);
}

function loadManifest(dataset) {
  if (dataset === 'pilot-v1') return buildPilotManifest();
  if (dataset === 'catalog-core-v2') return buildCatalogCoreV2Manifest();
  if (dataset === 'catalog-core-v3') return buildCatalogCoreV3Manifest();
  throw new Error(`Unknown datasetVersion: ${dataset}`);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && mode !== 'check') {
  console.error('DATABASE_URL is required for dry-run/apply/report');
  process.exit(1);
}

let manifest;
try {
  manifest = loadManifest(datasetArg);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (mode === 'apply' && !confirmed) {
  console.error('Refusing apply without confirmation. Set CATALOG_SEED_CONFIRM=1 or pass --confirm.');
  process.exit(2);
}

if (mode === 'check') {
  const { validateManifest } = await import('../src/modules/product-catalog/seed/validate-manifest.ts');
  const rejected = validateManifest(manifest);
  const out = {
    mode,
    datasetVersion: manifest.datasetVersion,
    previousDatasetVersion: manifest.previousDatasetVersion ?? null,
    checksum: manifest.checksum,
    productCount: manifest.productCount,
    status: rejected.length ? 'INVALID' : 'OK',
    rejected,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(rejected.length ? 1 : 0);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
  const report = await runCatalogSeed({ client: pool, manifest, mode });
  console.log(JSON.stringify(report, null, 2));

  const reportDir = resolve(__dirname, '../../../docs/recipe-platform');
  mkdirSync(reportDir, { recursive: true });
  const reportName =
    manifest.datasetVersion === 'pilot-v1'
      ? 'RP2_01C2A_PILOT_SEED_REPORT.json'
      : manifest.datasetVersion === 'catalog-core-v2'
        ? 'RP2_01C2B1_CATALOG_CORE_V2_REPORT.json'
        : 'RP2_01C2B2_CATALOG_CORE_V3_REPORT.json';
  const reportPath = resolve(reportDir, reportName);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ...report,
        generatedAt: new Date().toISOString(),
        schemaVersion: manifest.schemaVersion,
        sourcePolicyVersion: manifest.sourcePolicyVersion,
        releaseDate: manifest.releaseDate,
        previousDatasetVersion: manifest.previousDatasetVersion ?? null,
        addedProductCount: manifest.addedProductCount,
        matchedProductCount: manifest.matchedProductCount,
        reviewSummary: manifest.reviewSummary,
        sourceCoverage: manifest.sourceCoverage,
        categoryCoverage: manifest.categoryCoverage,
        formCoverage: manifest.formCoverage,
        legacyResolutionSummary: manifest.legacyResolutionSummary,
      },
      null,
      2,
    ),
  );
  console.error(`Wrote ${reportPath}`);
  process.exit(report.status === 'OK' || report.status === 'NO_OP' ? 0 : 1);
} finally {
  await pool.end();
}
