import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const apiRoot = join(__dirname, '..', '..', '..', '..');
const modulesRoot = join(apiRoot, 'src', 'modules');

function collectControllerFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectControllerFiles(full, out);
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

describe('destructive routes absence', () => {
  it('does not expose factory reset / drop database / delete-all-users endpoints', () => {
    const files = collectControllerFiles(modulesRoot);
    const haystack = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(haystack).not.toMatch(/@(Get|Post|Put|Patch|Delete)\([^)]*(factory-?reset|drop-?database|delete-?all-?users|wipe-?all)/i);
    expect(haystack).not.toMatch(/destroyEntireSystem|deleteEntireDatabase/);
  });
});

describe('bootstrap secrets absence', () => {
  it('bootstrap script has no hardcoded credentials', () => {
    const scriptPath = join(apiRoot, 'scripts', 'bootstrap-owner.mjs');
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain('OWNER_BOOTSTRAP_USERNAME');
    expect(script).toContain('OWNER_BOOTSTRAP_PASSWORD');
    expect(script).not.toMatch(/Zapolnaya/);
    expect(script).not.toMatch(/OWNER_BOOTSTRAP_PASSWORD\s*=\s*['"][^'"]+['"]/);
  });
});
