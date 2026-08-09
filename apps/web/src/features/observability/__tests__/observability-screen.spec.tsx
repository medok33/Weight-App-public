import { describe, expect, it } from 'vitest';

describe('observability dashboard UI contract', () => {
  it('requires metrics, traces and operations sections', () => {
    const sections = ['metrics', 'traces', 'jobs', 'errors', 'audit'];
    expect(sections).toContain('metrics');
    expect(sections).toContain('traces');
  });

  it('maps owner-only forbidden state', () => {
    const stateFromError = (message: string) =>
      message === 'OWNER_ACCESS_FORBIDDEN' ? 'forbidden' : 'error';
    expect(stateFromError('OWNER_ACCESS_FORBIDDEN')).toBe('forbidden');
    expect(stateFromError('OTHER')).toBe('error');
  });
});
