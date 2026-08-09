import { describe, expect, it } from 'vitest';
import {
  freezeReleaseCandidate,
  triageBetaBlockers,
  validateBetaBlockerItem,
} from '../domain/platform.policy';
import { PlatformService } from '../application/platform.service';

describe('platform STEP_170 beta triage', () => {
  it('is ready only when all blockers are fixed', () => {
    const result = triageBetaBlockers([
      { id: 'login', title: 'Login broken', severity: 'blocker', fixed: true },
      { id: 'pdf', title: 'PDF polish', severity: 'major', fixed: false },
    ]);
    expect(result.ready).toBe(true);
    expect(result.openMajors).toEqual(['pdf']);
    expect(result.openBlockers).toEqual([]);
  });

  it('blocks readiness when a blocker remains open', () => {
    const result = triageBetaBlockers([
      { id: 'health', title: 'health/ready 500', severity: 'blocker', fixed: false },
    ]);
    expect(result.ready).toBe(false);
    expect(result.openBlockers).toEqual(['health']);
    expect(() => validateBetaBlockerItem({ id: '', title: 'x', severity: 'minor', fixed: true })).toThrow(
      'BETA_BLOCKER_INVALID',
    );
    expect(() => triageBetaBlockers([])).toThrow('BETA_TRIAGE_EMPTY');
  });
});

describe('platform STEP_172 release candidate freeze', () => {
  it('freezes valid RC and is idempotent', () => {
    const service = new PlatformService();
    const first = service.freezeRc('OWNER', {
      version: '0.1.0',
      changelog: '- STEP_171 rehearsal done\n- health ready',
      commitSha: 'dad8307',
      frozenBy: 'owner-1',
    });
    expect(first.record.status).toBe('frozen');
    expect(first.duplicate).toBe(false);
    const second = service.freezeRc('OWNER', {
      version: '0.1.0',
      changelog: '- STEP_171 rehearsal done\n- health ready',
      commitSha: 'dad8307',
      frozenBy: 'owner-1',
    });
    expect(second.duplicate).toBe(true);
    expect(() =>
      freezeReleaseCandidate({
        version: 'bad',
        changelog: 'short',
        commitSha: 'zzz',
        frozenBy: 'x',
      }),
    ).toThrow('RC_VERSION_INVALID');
  });
});
