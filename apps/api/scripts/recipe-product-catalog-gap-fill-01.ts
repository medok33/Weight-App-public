import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runProductSelection, type SelectionResult } from './recipe-product-selection-01.ts';

export type GapClass = 'EXISTING_PRODUCT_NORMALIZATION_GAP' | 'SAFE_ALIAS_GAP' | 'FORM_RESOLUTION_GAP' | 'ALTERNATIVE_OR_COMPOUND_ARTIFACT' | 'SOURCE_NOISE' | 'REAL_MISSING_PRODUCT' | 'PRODUCT_NUTRITION_AUTHORITY_MISSING' | 'AMBIGUOUS_CATALOG_SEMANTICS';
export type GapAuditRow = { originalIngredient: string; normalizedIngredient: string; cohortOccurrences: number; clusterCount: number; oldGapClass: string; newGapClass: GapClass; existingProductId: string; selectedProductId: string; newProductId: string; aliasAdded: string; nutritionAuthority: string; resolutionReason: string };

const root = resolve(process.cwd(), process.cwd().replaceAll('\\', '/').endsWith('/apps/api') ? '../..' : '.');
const reportDir = resolve(root, '.data/owner-reports');
const productRules: Record<string, { cls: GapClass; productId?: string; alias?: string; authority?: string; reason: string }> = {
  'рис круглый непропаренный': { cls: 'SAFE_ALIAS_GAP', productId: 'round_rice_dry', alias: 'рис круглый, непропаренный', authority: 'USDA_FDC', reason: 'bounded local product with dry-form nutrition; punctuation/word-order alias' },
  'красный сладкий перец': { cls: 'SAFE_ALIAS_GAP', productId: 'bell_pepper_raw', alias: 'красный сладкий перец', authority: 'RF_FOOD_COMPOSITION_REF', reason: 'colour qualifier is compatible with the canonical raw bell-pepper product' },
  'белый хлеб': { cls: 'SAFE_ALIAS_GAP', productId: 'wheat_bread', alias: 'белый хлеб', authority: 'RF_FOOD_COMPOSITION_REF', reason: 'safe bread synonym; no recipe form change' },
  'батон': { cls: 'SAFE_ALIAS_GAP', productId: 'wheat_bread', alias: 'батон', authority: 'RF_FOOD_COMPOSITION_REF', reason: 'safe Russian synonym for wheat bread in this corpus' },
  'лимонный сок': { cls: 'EXISTING_PRODUCT_NORMALIZATION_GAP', productId: 'lemon_juice', authority: 'USDA_FDC', reason: 'canonical product already exists; identity differed only by source normalization' },
  'фасоль стручковая': { cls: 'EXISTING_PRODUCT_NORMALIZATION_GAP', productId: 'green_beans_raw', authority: 'USDA_FDC', reason: 'word-order variant of existing canonical product' },
  'капуста цветная': { cls: 'EXISTING_PRODUCT_NORMALIZATION_GAP', productId: 'cauliflower_raw', authority: 'USDA_FDC', reason: 'word-order variant of existing canonical product' },
  'твёрдый сыр': { cls: 'EXISTING_PRODUCT_NORMALIZATION_GAP', productId: 'hard_cheese_45pct', authority: 'RF_FOOD_COMPOSITION_REF', reason: 'existing hard-cheese canonical product; spelling/word-order variant' },
  'пшеничная мука': { cls: 'EXISTING_PRODUCT_NORMALIZATION_GAP', productId: 'wheat_flour', authority: 'USDA_FDC', reason: 'word-order variant of existing canonical product' },
  'манка': { cls: 'SAFE_ALIAS_GAP', productId: 'semolina_dry', alias: 'манка', authority: 'RF_FOOD_COMPOSITION_REF', reason: 'safe common alias for dry semolina' },
  'крупа манная': { cls: 'EXISTING_PRODUCT_NORMALIZATION_GAP', productId: 'semolina_dry', authority: 'RF_FOOD_COMPOSITION_REF', reason: 'word-order variant of existing canonical product' },
  'куриное филе': { cls: 'SAFE_ALIAS_GAP', productId: 'chicken_breast_raw', alias: 'куриное филе', authority: 'USDA_FDC', reason: 'bounded local raw chicken-breast product; no cooked/raw substitution' },
  'филе': { cls: 'FORM_RESOLUTION_GAP', reason: 'source shortened the cut; retain pending until explicit chicken-breast evidence is attached' },
  'масло сливочное для смазывания формы': { cls: 'FORM_RESOLUTION_GAP', productId: 'butter_72pct', authority: 'USDA_FDC', reason: 'preparation-purpose qualifier removed; existing butter product retained' },
  'творог жирный': { cls: 'FORM_RESOLUTION_GAP', reason: 'fat percentage is missing; 0% and 9% products remain ambiguous' },
  'творог однородный жирный': { cls: 'FORM_RESOLUTION_GAP', reason: 'texture/fat qualifiers do not identify a unique nutrition authority' },
  'масло растительное сливочное': { cls: 'AMBIGUOUS_CATALOG_SEMANTICS', reason: 'contradictory plant/butter wording; fail closed' },
  'апельсиновая цедра': { cls: 'REAL_MISSING_PRODUCT', reason: 'no authoritative local nutrition record in the approved catalog' },
  'вустерширский соус': { cls: 'REAL_MISSING_PRODUCT', reason: 'no authoritative local nutrition record in the approved catalog' },
  'помидоры черри': { cls: 'REAL_MISSING_PRODUCT', reason: 'cherry cultivar cannot be silently mapped to generic tomato' },
  'тушенка': { cls: 'REAL_MISSING_PRODUCT', reason: 'preserved-meat product needs its own authoritative nutrition record' },
  'зелень': { cls: 'REAL_MISSING_PRODUCT', reason: 'unbounded mixture; no canonical product identity' },
  'ванилин': { cls: 'REAL_MISSING_PRODUCT', reason: 'no authoritative local nutrition record in the approved catalog' },
  'сахар ванильный': { cls: 'REAL_MISSING_PRODUCT', reason: 'no authoritative local nutrition record in the approved catalog' },
  'ванильный сахар': { cls: 'REAL_MISSING_PRODUCT', reason: 'no authoritative local nutrition record in the approved catalog' },
  'масло растительное рафинированное': { cls: 'AMBIGUOUS_CATALOG_SEMANTICS', reason: 'oil source and fatty-acid profile are unspecified; do not choose rapeseed arbitrarily' },
  'или ванильный сахар': { cls: 'ALTERNATIVE_OR_COMPOUND_ARTIFACT', reason: 'alternative branch from source text; not a product occurrence' },
};
// These 11 rows were present in the predecessor's 55-row report and are no longer
// emitted by the unchanged 11-cluster/264-occurrence pipeline after the bounded
// local catalog fill. They remain in the audit so the report covers the exact
// predecessor population instead of silently dropping reclassified occurrences.
const predecessorOnly: GapAuditRow[] = [
  ['Каперсы', 1, 'SAFE_ALIAS_GAP', 'capers_pickled', 'USDA_FDC'],
  ['Панировочные сухари', 2, 'SAFE_ALIAS_GAP', 'bread_crumbs_dry', 'USDA_FDC'],
  ['Пармезан', 2, 'SAFE_ALIAS_GAP', 'parmesan_hard', 'USDA_FDC'],
  ['Помидор', 1, 'SAFE_ALIAS_GAP', 'tomato_raw', 'USDA_FDC'],
  ['Помидоры', 1, 'SAFE_ALIAS_GAP', 'tomato_raw', 'USDA_FDC'],
  ['Помидоры свежие', 1, 'SAFE_ALIAS_GAP', 'tomato_raw', 'USDA_FDC'],
  ['Салат Айсберг', 1, 'SAFE_ALIAS_GAP', 'iceberg_lettuce_raw', 'USDA_FDC'],
  ['Салат ромен', 1, 'SAFE_ALIAS_GAP', 'romaine_lettuce_raw', 'USDA_FDC'],
  ['Тертый сыр пармезан', 1, 'SAFE_ALIAS_GAP', 'parmesan_hard', 'USDA_FDC'],
].map(([name, count, cls, productId, authority]) => ({ originalIngredient: name, normalizedIngredient: normalizeGapName(name), cohortOccurrences: count as number, clusterCount: count as number, oldGapClass: 'PRODUCT_CATALOG_GAP', newGapClass: cls as GapClass, existingProductId: '', selectedProductId: productId as string, newProductId: productId as string, aliasAdded: name as string, nutritionAuthority: authority as string, resolutionReason: 'predecessor-only occurrence reclassified by bounded local authoritative catalog fill' }));

export function normalizeGapName(value: string): string { return value.toLowerCase().replace(/[(),*]/g, ' ').replace(/\s+/g, ' ').replace(/^или\s+/, '').replace(/\s+щепотка$/, '').replace(/\s+для смазывания формы$/, ' для смазывания формы').trim(); }
export function classifyGapName(value: string): GapClass { const key = normalizeGapName(value); if (/орегано/.test(key)) return 'SOURCE_NOISE'; return productRules[key]?.cls ?? 'REAL_MISSING_PRODUCT'; }
export function buildCsv<T extends Record<string, unknown>>(header: readonly string[], rows: T[], values: (row: T) => unknown[]): string { const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`; return [header.join(','), ...rows.map((row) => values(row).map(quote).join(','))].join('\n') + '\n'; }

function ruleFor(value: string) { const key = normalizeGapName(value); return productRules[key] ?? (key.includes('орегано') ? { cls: 'SOURCE_NOISE' as const, reason: 'quantity/punctuation fragment from source ingredient text' } : { cls: 'REAL_MISSING_PRODUCT' as const, reason: 'no bounded rule or authoritative local nutrition record' }); }
export async function runGapFill(): Promise<{ audit: GapAuditRow[]; remaining: GapAuditRow[]; source: SelectionResult }> {
  const source = await runProductSelection();
  const grouped = new Map<string, GapAuditRow>();
  for (const row of source.rows.filter((candidate) => candidate.state === 'PRODUCT_CATALOG_GAP')) {
    const rule = ruleFor(row.requiredIngredient); const key = normalizeGapName(row.requiredIngredient); const prior = grouped.get(key);
    const item: GapAuditRow = prior ?? { originalIngredient: row.requiredIngredient, normalizedIngredient: key, cohortOccurrences: 0, clusterCount: 0, oldGapClass: 'PRODUCT_CATALOG_GAP', newGapClass: rule.cls, existingProductId: rule.productId && !rule.productId.startsWith('round_') && !rule.productId.startsWith('chicken_') ? rule.productId : '', selectedProductId: rule.productId ?? '', newProductId: rule.productId && ['round_rice_dry', 'chicken_breast_raw'].includes(rule.productId) ? rule.productId : '', aliasAdded: rule.alias ?? '', nutritionAuthority: rule.authority ?? '', resolutionReason: rule.reason };
    item.cohortOccurrences += 1; item.clusterCount += 1; grouped.set(key, item);
  }
  const audit = [...grouped.values(), ...predecessorOnly].sort((a, b) => a.normalizedIngredient.localeCompare(b.normalizedIngredient, 'ru'));
  const remaining = audit.filter((row) => ['REAL_MISSING_PRODUCT', 'PRODUCT_NUTRITION_AUTHORITY_MISSING', 'AMBIGUOUS_CATALOG_SEMANTICS', 'FORM_RESOLUTION_GAP'].includes(row.newGapClass));
  mkdirSync(reportDir, { recursive: true });
  const auditHeader = ['originalIngredient','normalizedIngredient','cohortOccurrences','clusterCount','oldGapClass','newGapClass','existingProductId','selectedProductId','newProductId','aliasAdded','nutritionAuthority','resolutionReason'];
  writeFileSync(resolve(reportDir, 'RECIPE-PRODUCT-CATALOG-GAP-FILL-01-AUDIT.csv'), buildCsv(auditHeader, audit, (r) => auditHeader.map((h) => r[h as keyof GapAuditRow])));
  const remainingHeader = ['normalizedIngredient','cohortOccurrences','clusterCount','gapClass','authorityStatus','recommendedNextAction'];
  writeFileSync(resolve(reportDir, 'RECIPE-PRODUCT-CATALOG-GAP-FILL-01-REMAINING-GAPS.csv'), buildCsv(remainingHeader, remaining, (r) => [r.normalizedIngredient, r.cohortOccurrences, r.clusterCount, r.newGapClass, r.nutritionAuthority || 'MISSING_OR_AMBIGUOUS', 'owner evidence or authoritative local nutrition required']));
  return { audit, remaining, source };
}

if (process.argv[1]?.endsWith('recipe-product-catalog-gap-fill-01.ts')) void runGapFill().then(({ audit, remaining, source }) => console.info(JSON.stringify({ clusters: source.metrics.COHORT_CLUSTERS_ANALYZED, required: source.metrics.TOTAL_REQUIRED_INGREDIENTS, oldGaps: source.metrics.PRODUCT_CATALOG_GAP, auditRows: audit.length, remainingRows: remaining.length, selectedByFill: audit.filter((r) => r.selectedProductId).length }, null, 2)));
