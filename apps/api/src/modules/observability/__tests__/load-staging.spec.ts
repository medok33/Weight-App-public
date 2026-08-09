import { describe, expect, it } from 'vitest';
import {
  anonymizeStagingSeed,
  assertNotProductionSeedTarget,
  assertStagingEnvironment,
  collectBetaReleaseMetrics,
  evaluateLoadSuite,
  planPublicMvpDeployment,
  decidePostRelease,
  summarizeLoadSamples,
} from '../domain/observability.policy';

describe('observability STEP_162/164', () => {
  it('evaluates critical-path load samples against thresholds', () => {
    const samples = [
      { path: 'health.live' as const, latencyMs: 40, statusCode: 200 },
      { path: 'health.live' as const, latencyMs: 50, statusCode: 200 },
      { path: 'health.ready' as const, latencyMs: 60, statusCode: 200 },
      { path: 'health.ready' as const, latencyMs: 70, statusCode: 200 },
    ];
    const suite = evaluateLoadSuite(samples);
    expect(suite.passed).toBe(true);
    expect(summarizeLoadSamples('health.live', samples).p95Ms).toBeGreaterThan(0);
    expect(() => evaluateLoadSuite([])).toThrow('LOAD_SAMPLES_EMPTY');
  });

  it('anonymizes staging seed and blocks production DB names', () => {
    expect(assertStagingEnvironment('staging')).toBe('staging');
    expect(() => assertStagingEnvironment('production')).toThrow('STAGING_ENV_INVALID');
    expect(() => assertNotProductionSeedTarget('weight_app')).toThrow('STAGING_SEED_PRIMARY_FORBIDDEN');
    const user = anonymizeStagingSeed({ email: 'real@person.com', displayName: 'Real', locale: 'ru' }, 0);
    expect(user.email).toBe('staging.user001@example.invalid');
    expect(user.displayName).toBe('Staging User 001');
    expect(user.email).not.toContain('person.com');
  });
});

describe('observability STEP_169 beta metrics', () => {
  it('collects product/safety/ai/failure metrics', () => {
    const bundle = collectBetaReleaseMetrics({
      productEvents: 10,
      safetyEscalations: 1,
      aiCostUsd: 0.42,
      aiFailures: 2,
      requestFailures: 3,
    });
    expect(bundle.metrics.find((m) => m.name === 'ai.cost_usd')?.value).toBe(0.42);
    expect(bundle.snapshot.aiFailures).toBe(2);
    expect(() =>
      collectBetaReleaseMetrics({
        productEvents: -1,
        safetyEscalations: 0,
        aiCostUsd: 0,
        aiFailures: 0,
        requestFailures: 0,
      }),
    ).toThrow('BETA_METRICS_INVALID');
  });
});

describe('observability STEP_173/174 deploy + post-release', () => {
  it('plans public MVP deploy and decides keep/rollback', () => {
    const plan = planPublicMvpDeployment({
      version: '0.1.0',
      environment: 'staging',
      commitSha: 'abcdef1',
    });
    expect(plan.executable).toBe(true);
    expect(plan.steps).toContain('post.release.verify');
    const keep = decidePostRelease([
      { id: 'health_live', ok: true },
      { id: 'health_ready', ok: true },
      { id: 'error_rate', ok: true },
      { id: 'owner_rbac', ok: true },
      { id: 'payments_webhook', ok: true },
    ]);
    expect(keep.decision).toBe('keep');
    const rollback = decidePostRelease([{ id: 'health_live', ok: false }]);
    expect(rollback.decision).toBe('rollback');
    expect(rollback.failed.length).toBeGreaterThan(0);
  });
});
