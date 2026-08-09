/**
 * Repository content check entrypoint (no DB apply, no USER data, no network).
 */
import { analyseContentCoverage, formatCoverageConsoleSummary } from './coverage-analyser';
import { WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY } from './product-policy';
import type { ContentPolicyProbe } from './validate-content-policy';
import type { ContentCoverageReport } from './content.types';

export type ContentCheckMode = 'repository' | 'require-full-coverage';

export type ContentCheckResult = {
  mode: ContentCheckMode;
  ok: boolean;
  exitCode: number;
  report: ContentCoverageReport;
  summary: string;
};

export function runWorkoutEnergyContentCheck(opts: {
  mode?: ContentCheckMode;
  generatedFromCommit?: string | null;
  /** Test-only policy mutation probe. */
  productPolicy?: ContentPolicyProbe;
}): ContentCheckResult {
  const mode = opts.mode ?? 'repository';
  const report = analyseContentCoverage({
    generatedFromCommit: opts.generatedFromCommit ?? null,
    productPolicy: opts.productPolicy,
  });
  const summary = formatCoverageConsoleSummary(report);
  const structuralErrors = report.issues.filter((i) => i.level === 'error').length;
  const policyErrors = report.issues.filter((i) => i.surface === 'policy' && i.level === 'error')
    .length;

  if (mode === 'require-full-coverage') {
    const ok =
      report.fullCoverageSatisfied &&
      structuralErrors === 0 &&
      policyErrors === 0 &&
      report.coveragePercent >= WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.requiredCoveragePercent;
    return {
      mode,
      ok,
      exitCode: ok ? 0 : 1,
      report,
      summary: `${summary}\nSTRICT_FULL_COVERAGE_GATE=${ok ? 'PASS' : 'FAIL'}`,
    };
  }

  // Repository mode: structural + policy validity may PASS while coverage remains incomplete.
  const ok = structuralErrors === 0 && policyErrors === 0;
  return {
    mode,
    ok,
    exitCode: ok ? 0 : 1,
    report,
    summary,
  };
}
