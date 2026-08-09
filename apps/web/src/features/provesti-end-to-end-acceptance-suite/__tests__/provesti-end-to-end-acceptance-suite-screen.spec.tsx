import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_SCENARIOS } from '../model/provesti-end-to-end-acceptance-suite.types';

describe('acceptance suite UI contract', () => {
  it('lists critical beta paths', () => {
    expect(ACCEPTANCE_SCENARIOS.map((s) => s.id)).toContain('health.ready');
    expect(ACCEPTANCE_SCENARIOS.map((s) => s.id)).toContain('export.share');
    expect(ACCEPTANCE_SCENARIOS.length).toBeGreaterThanOrEqual(6);
  });
});
