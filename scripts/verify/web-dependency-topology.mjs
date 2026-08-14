import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolved(path) {
  try { return realpathSync.native(path); } catch { return null; }
}

export function inspectWebDependencyTopology(repoRoot) {
  const root = resolved(repoRoot);
  if (!root) return { ok: false, reason: 'WEB_DEPENDENCY_ROOT_MISSING' };
  const paths = [resolve(root, 'node_modules'), resolve(root, 'apps/web/node_modules')];
  for (const path of paths) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return { ok: false, reason: `WEB_DEPENDENCY_PATH_MISSING:${path}` };
    const target = resolved(path);
    if (!target || !inside(root, target)) return { ok: false, reason: `WEB_DEPENDENCY_TARGET_OUTSIDE_REPOSITORY:${path}` };
  }
  const webModules = resolve(root, 'apps/web/node_modules');
  for (const entry of readdirSync(webModules, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const path = resolve(webModules, entry.name);
    const target = resolved(path);
    if (!target || !inside(root, target)) return { ok: false, reason: `WEB_PACKAGE_LINK_OUTSIDE_REPOSITORY:${entry.name}` };
  }
  return { ok: true, root, webModules };
}

export function assertWebDependencyTopology(repoRoot) {
  const result = inspectWebDependencyTopology(repoRoot);
  if (!result.ok) throw new Error(result.reason);
  return result;
}
