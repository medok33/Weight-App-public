import { assertDisposableConfig, isTrue } from './disposable-runtime.mjs';
import { resolvePnpmInvocation, runBoundedProcess } from './orchestration.mjs';

if (isTrue(process.env.WEIGHT_APP_DISPOSABLE_MODE)) {
  assertDisposableConfig(process.env);
}

const runner = resolvePnpmInvocation(process.env);
const commands = [
  { name: 'db:check-migrations', args: ['db:check-migrations'], timeoutMs: 120_000 },
  { name: 'workout-energy:content:check', args: ['workout-energy:content:check'], timeoutMs: 120_000 },
  { name: 'ui:check-ru', args: ['ui:check-ru'], timeoutMs: 120_000 },
  { name: 'lint', args: ['lint'], timeoutMs: 120_000 },
  { name: 'typecheck', args: ['typecheck'], timeoutMs: 120_000 },
  { name: 'test', args: ['test'], timeoutMs: 1_500_000 },
];

for (const command of commands) {
  const started = Date.now();
  process.stdout.write(`VERIFY_STAGE_START ${new Date().toISOString()} ${command.name} timeoutMs=${command.timeoutMs}\n`);
  const args = [...runner.argsPrefix, ...command.args];
  const result = await runBoundedProcess(runner.command, args, {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: command.timeoutMs,
    label: command.name,
  });
  const elapsed = Date.now() - started;
  if (result.timedOut) {
    process.stderr.write(`VERIFY_STAGE_TIMEOUT ${command.name} elapsedMs=${elapsed} timeoutMs=${command.timeoutMs}\n`);
    process.exit(124);
  }
  if (result.exitCode !== 0) {
    process.stderr.write(`VERIFY_STAGE_FAIL ${command.name} elapsedMs=${elapsed} status=${result.exitCode}\n`);
    process.exit(result.exitCode);
  }
  process.stdout.write(`VERIFY_STAGE_PASS ${command.name} elapsedMs=${elapsed}\n`);
}

process.stdout.write('verify-all: passed\n');
