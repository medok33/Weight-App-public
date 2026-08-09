#!/usr/bin/env node
/**
 * workout-energy:content:load
 * Controlled content loader — validate | dry-run | apply (disposable DB only).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const runner = path.join(__dirname, 'workout-energy-content-load-runner.ts');
const args = process.argv.slice(2);

const result = spawnSync(process.execPath, [tsxCli, runner, ...args], {
  stdio: 'inherit',
  env: process.env,
  cwd: path.join(__dirname, '..'),
});

process.exit(result.status ?? 1);
