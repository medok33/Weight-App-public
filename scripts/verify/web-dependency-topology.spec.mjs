import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWebDependencyTopology } from './web-dependency-topology.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'web-topology-'));
  mkdirSync(join(root, 'apps/web/node_modules'), { recursive: true });
  mkdirSync(join(root, 'node_modules/.pnpm/next/node_modules/next'), { recursive: true });
  mkdirSync(join(root, 'node_modules/.pnpm/react'), { recursive: true });
  writeFileSync(join(root, 'node_modules/.pnpm/react/index.js'), '');
  symlinkSync(join(root, 'node_modules/.pnpm/next/node_modules/next'), join(root, 'apps/web/node_modules/next'), 'junction');
  return root;
}

test('accepts task-local pnpm workspace topology', () => {
  const root = fixture();
  try { assert.equal(inspectWebDependencyTopology(root).ok, true); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects cross-worktree node_modules junction', () => {
  const root = fixture();
  const external = mkdtempSync(join(tmpdir(), 'web-external-'));
  try {
    rmSync(join(root, 'apps/web/node_modules'), { recursive: true, force: true });
    symlinkSync(join(external), join(root, 'apps/web/node_modules'), 'junction');
    const result = inspectWebDependencyTopology(root);
    assert.equal(result.ok, false);
    assert.match(result.reason, /OUTSIDE_REPOSITORY/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(external, { recursive: true, force: true }); }
});

test('rejects missing dependency target', () => {
  const root = fixture();
  try {
    rmSync(join(root, 'node_modules/.pnpm/next'), { recursive: true, force: true });
    assert.equal(inspectWebDependencyTopology(root).ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
