import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Production builds must not inherit a shell NODE_ENV=development (breaks React SSR).
delete process.env.NODE_ENV;

const webDir = path.dirname(fileURLToPath(import.meta.url));
const nextBin = path.join(webDir, '..', 'node_modules', 'next', 'dist', 'bin', 'next');
const result = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: path.join(webDir, '..'),
  stdio: 'inherit',
  env: { ...process.env },
});
process.exit(result.status ?? 1);
