/**
 * CLI runner for workout-energy:content:check
 */
import { execSync } from 'node:child_process';
import { runWorkoutEnergyContentCheck } from '../src/modules/workout-engine/energy/content/content-check';

function parseMode(argv: string[]): 'repository' | 'require-full-coverage' {
  if (argv.includes('--require-full-coverage') || argv.includes('--strict')) {
    return 'require-full-coverage';
  }
  return 'repository';
}

function tryCommitSha(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const mode = parseMode(process.argv.slice(2));
const result = runWorkoutEnergyContentCheck({
  mode,
  generatedFromCommit: tryCommitSha(),
});

process.stdout.write(`${result.summary}\n`);
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
}

process.exit(result.exitCode);
