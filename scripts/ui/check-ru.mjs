#!/usr/bin/env node
/**
 * UI-RU-01 — automated Russian localization audit.
 * Checks message catalogs, forbidden English UI literals, and raw enum render patterns.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const webSrc = join(root, 'apps/web/src');

const FORBIDDEN_LITERALS = [
  'Production Recipes',
  'Price Intelligence',
  'Media review',
  'Sync mock API',
  'Something went wrong',
  'No data',
  'Loading…',
  'Retry',
  'Forbidden',
  'Coverage EMPTY',
  'Coverage UNDERFILLED',
  'TEST_ONLY recipes',
  'Eligible current versions',
  'Open revalidation',
  'Duplicate blockers',
  'Stale Search Decisions',
  'Dirty coverage',
  'Dashboard',
  'Meal Plan',
  'Workout Plan',
  'Shopping',
  'Prices',
  'Subscription Management',
  'System Status',
];

const RAW_ENUM_PATTERNS = [
  />\s*\{[a-zA-Z_][\w]*\.(lifecycleStatus|dataClass|rightsStatus|moderationStatus)\s*\}/,
  />\s*\[\{?[a-zA-Z_][\w]*\.status\}?\]/,
  />\s*(PUBLISHED|NEEDS_REVALIDATION|OWNED_UPLOAD|ACTIVE_LICENSED|EMPTY|UNDERFILLED|CRITICAL)\s*</,
];

const ALLOWED_BRANDS = new Set([
  'Weight App',
  'Food.ru',
  'Аймкук',
  'RussianFood',
  'DeepSeek',
  'PostgreSQL',
  'Redis',
  'API',
  'OWNER',
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) out.push(full);
  }
  return out;
}

function loadMessages(path) {
  const src = readFileSync(path, 'utf8');
  const keys = new Set();
  const dupes = [];
  const re = /['"]([a-zA-Z0-9_.]+)['"]\s*:/g;
  let m;
  while ((m = re.exec(src))) {
    const key = m[1];
    if (keys.has(key)) dupes.push(key);
    keys.add(key);
  }
  return { keys, dupes, src };
}

const errors = [];
const warnings = [];

const ruPath = join(webSrc, 'i18n/messages/ru.ts');
const enPath = join(webSrc, 'i18n/messages/en.ts');
const adminRuPath = join(webSrc, 'i18n/messages/admin.ru.ts');
const adminEnPath = join(webSrc, 'i18n/messages/admin.en.ts');

for (const p of [ruPath, enPath, adminRuPath, adminEnPath]) {
  try {
    statSync(p);
  } catch {
    errors.push(`Missing message catalog: ${relative(root, p)}`);
  }
}

const ru = loadMessages(ruPath);
const en = loadMessages(enPath);
const adminRu = loadMessages(adminRuPath);
const adminEn = loadMessages(adminEnPath);

for (const d of [...ru.dupes, ...en.dupes, ...adminRu.dupes, ...adminEn.dupes]) {
  errors.push(`Duplicate message key: ${d}`);
}

function checkParity(leftName, left, rightName, right) {
  for (const key of left) {
    if (!right.has(key)) errors.push(`${rightName} is missing key from ${leftName}: ${key}`);
  }
  for (const key of right) {
    if (!left.has(key)) errors.push(`${leftName} is missing key from ${rightName}: ${key}`);
  }
}

checkParity('ru', ru.keys, 'en', en.keys);
const effectiveAdminEnKeys = adminEn.src.includes('...adminRu') ? adminRu.keys : adminEn.keys;
checkParity('admin.ru', adminRu.keys, 'admin.en', effectiveAdminEnKeys);

const adminKeyRe = /['"](admin\.[a-zA-Z0-9_.]+)['"]/g;
const adminKeysDeclared = new Set();
let am;
const adminKeysFile = readFileSync(join(webSrc, 'i18n/admin-message-keys.ts'), 'utf8');
while ((am = adminKeyRe.exec(adminKeysFile))) adminKeysDeclared.add(am[1]);
while ((am = adminKeyRe.exec(adminRu.src))) {
  if (!adminKeysDeclared.has(am[1]) && am[1].startsWith('admin.')) {
    // keys in admin.ru values aren't keys; only left-hand keys matter via loadMessages
  }
}
for (const key of adminRu.keys) {
  if (key.startsWith('admin.') && !adminKeysDeclared.has(key)) {
    warnings.push(`admin.ru key not in AdminMessageKey union: ${key}`);
  }
}
for (const key of adminKeysDeclared) {
  if (!adminRu.keys.has(key)) {
    errors.push(`Missing admin.ru translation for key: ${key}`);
  }
}

const files = walk(join(webSrc, 'features'))
  .filter((file) => file.replace(/\\/g, '/').includes('/components/'))
  .concat(walk(join(webSrc, 'components')))
  .concat(walk(join(webSrc, 'app')));
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (rel.includes('/i18n/') || rel.includes('/__tests__/') || /\.(spec|test)\.[jt]sx?$/.test(rel)) continue;
  const src = readFileSync(file, 'utf8');
  for (const lit of FORBIDDEN_LITERALS) {
    if (src.includes(`'${lit}'`) || src.includes(`"${lit}"`) || src.includes(`>${lit}<`)) {
      if (ALLOWED_BRANDS.has(lit)) continue;
      errors.push(`${rel}: forbidden UI literal «${lit}»`);
    }
  }
  for (const pat of RAW_ENUM_PATTERNS) {
    if (pat.test(src) && !rel.includes('technical')) {
      warnings.push(`${rel}: possible raw enum render pattern ${pat}`);
    }
  }
  if (/admin\.[a-zA-Z0-9_.]+/.test(src) === false && /MISSING_I18N/.test(src)) {
    errors.push(`${rel}: translation key leak pattern`);
  }
}

if (warnings.length) {
  process.stdout.write(`ui:check-ru warnings (${warnings.length}):\n`);
  for (const w of warnings.slice(0, 40)) process.stdout.write(`  - ${w}\n`);
}

if (errors.length) {
  process.stderr.write(`ui:check-ru FAILED (${errors.length}):\n`);
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

process.stdout.write(
  `ui:check-ru PASS (admin keys=${adminKeysDeclared.size}, ru keys≈${ru.keys.size}, files scanned=${files.length})\n`,
);
