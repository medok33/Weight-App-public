import { describe, expect, it } from 'vitest';
import { assertResearchWorkerNetworkCalls } from './research-retention.job';

describe('STEP_215 worker policy-before-network', () => {
  it('research worker contract remains networkCalls=0 (policy before any transport)', () => {
    expect(assertResearchWorkerNetworkCalls()).toBe(0);
  });
});
