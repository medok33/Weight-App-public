import { assertDisposableConfig, isTrue } from './disposable-runtime.mjs';
import { resolvePnpmInvocation, runBoundedProcess } from './orchestration.mjs';

if (isTrue(process.env.WEIGHT_APP_DISPOSABLE_MODE)) {
  assertDisposableConfig(process.env);
}

const runner = resolvePnpmInvocation(process.env);
const publicNotApplicableTests = [
  { file: 'apps/api/test/database/owner-mfa.persistence.spec.ts', test: 'emergency reset invalidates sessions/credential/challenges, needs confirm, audits without secrets', classification: 'PRIVATE_OPERATIONAL_TEST_NOT_APPLICABLE', reason: 'PRIVATE_OPERATIONAL_DEPENDENCY_EXCLUDED_FROM_PUBLIC_REPOSITORY' },
  { file: 'apps/web/src/lib/__tests__/deploy-01b-docker-contract.spec.ts', test: 'prod-like compose has no app source mounts and orders migrate before api', classification: 'PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE', reason: 'PRIVATE_DEPLOYMENT_SURFACE_EXCLUDED_FROM_PUBLIC_REPOSITORY' },
  { file: 'apps/web/src/lib/__tests__/deploy-01b-docker-contract.spec.ts', test: 'staging and production require immutable images in compose files', classification: 'PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE', reason: 'PRIVATE_DEPLOYMENT_SURFACE_EXCLUDED_FROM_PUBLIC_REPOSITORY' },
  { file: 'apps/web/src/lib/__tests__/deploy-01c-environment-contract.spec.ts', test: 'documents separate compose project names', classification: 'PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE', reason: 'PRIVATE_DEPLOYMENT_SURFACE_EXCLUDED_FROM_PUBLIC_REPOSITORY' },
  { file: 'apps/web/src/lib/__tests__/deploy-01c-environment-contract.spec.ts', test: 'keeps INTERNAL_API_BASE_URL out of private env templates', classification: 'PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE', reason: 'PRIVATE_DEPLOYMENT_SURFACE_EXCLUDED_FROM_PUBLIC_REPOSITORY' },
  { file: 'apps/web/src/lib/__tests__/deploy-01d-workflow-contract.spec.ts', test: 'publishes only from release workflow with lowercase GHCR names', classification: 'PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE', reason: 'PRIVATE_DEPLOYMENT_SURFACE_EXCLUDED_FROM_PUBLIC_REPOSITORY' },
];
for (const test of publicNotApplicableTests) {
  process.stdout.write(`PUBLIC_CI_TEST_NOT_APPLICABLE ${JSON.stringify(test)}\n`);
}
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
process.stdout.write(`PUBLIC_CODE_BASELINE_READY ${JSON.stringify({ ready: true, privateDeploymentValidation: 'NOT_APPLICABLE_TO_PUBLIC_REPOSITORY', publicNotApplicableTests })}\n`);
