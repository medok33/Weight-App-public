import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function resolvePnpmInvocation() {
  const execPath = process.env.npm_execpath;
  if (execPath && existsSync(execPath)) {
    return { command: process.execPath, argsPrefix: [execPath] };
  }
  return { command: 'pnpm', argsPrefix: [], shell: true };
}

const step = process.argv[2];
if (!step) {
  console.error('Usage: pnpm verify:step STEP_XXX');
  process.exit(1);
}

const runner = resolvePnpmInvocation();
const result = spawnSync(runner.command, [...runner.argsPrefix, 'run', 'verify'], {
  stdio: 'inherit',
  shell: Boolean(runner.shell),
  env: process.env,
});
process.exit(result.status ?? 1);
