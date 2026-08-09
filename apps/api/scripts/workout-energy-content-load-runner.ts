/**
 * CLI runner for workout-energy:content:load
 */
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import {
  formatContentLoadReport,
  runWorkoutEnergyContentLoad,
  type ContentLoadMode,
} from '../src/modules/workout-engine/energy/content/content-loader';

function parseMode(argv: string[]): ContentLoadMode | null {
  const modeArg = argv.find((a) => a.startsWith('--mode='));
  if (!modeArg) return null;
  const mode = modeArg.slice('--mode='.length);
  if (mode === 'validate' || mode === 'dry-run' || mode === 'apply') {
    return mode;
  }
  return null;
}

const argv = process.argv.slice(2);
const mode = parseMode(argv);

if (!mode) {
  process.stderr.write(
    'ERROR: --mode=validate|dry-run|apply is required (fail-closed)\n',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  let db: PrismaService | undefined;
  if (mode === 'dry-run' || mode === 'apply') {
    if (!process.env.DATABASE_URL?.trim()) {
      process.stderr.write('ERROR: DATABASE_URL is required for dry-run/apply\n');
      process.exit(1);
    }
    db = new PrismaService();
  }

  const report = await runWorkoutEnergyContentLoad({
    mode,
    db,
    databaseUrl: process.env.DATABASE_URL,
  });

  process.stdout.write(`${formatContentLoadReport(report)}\n`);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  if (db) {
    await db.onModuleDestroy();
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
