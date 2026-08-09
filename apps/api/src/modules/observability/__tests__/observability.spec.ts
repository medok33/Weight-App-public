import { describe, expect, it } from 'vitest';
import { decidePostRelease, planPublicMvpDeployment } from '../domain/observability.policy';

describe('observability STEP_173 public MVP deploy', () => {
  it('plans staging deploy as executable', () => {
    const plan = planPublicMvpDeployment({
      version: '0.1.0',
      environment: 'staging',
      commitSha: 'abcdef12',
    });
    expect(plan.executable).toBe(true);
    expect(plan.steps[0]).toBe('preflight.health');
  });

  it('rejects invalid version', () => {
    expect(() =>
      planPublicMvpDeployment({ version: 'x', environment: 'staging', commitSha: 'abcdef1' }),
    ).toThrow('MVP_DEPLOY_VERSION_INVALID');
  });
});

describe('observability STEP_174 post-release', () => {
  it('rolls back when a required check fails', () => {
    expect(decidePostRelease([{ id: 'health_ready', ok: false }]).decision).toBe('rollback');
  });
});
