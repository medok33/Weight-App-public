/** STEP_215C worker policy — multi-source fixture adapters stay networkCalls=0. */

import { describe, expect, it } from 'vitest';
import { assertResearchWorkerNetworkCalls } from './research-retention.job';

describe('STEP_215C worker multi-source policy-before-network', () => {
  it('research worker contract remains networkCalls=0 for multi-source fixture stage', () => {
    expect(assertResearchWorkerNetworkCalls()).toBe(0);
  });
});
