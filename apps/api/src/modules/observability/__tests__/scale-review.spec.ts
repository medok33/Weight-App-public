import { describe, expect, it } from 'vitest';
import { scaleReviewSummary } from '../application/observability.service';

describe('scale review STEP_189', () => {
  it('defers infrastructure changes until thresholds trip', () => {
    expect(scaleReviewSummary({}).decision).toBe('DEFER_WITH_THRESHOLDS');
    expect(scaleReviewSummary({ p95Ms: 600 }).triggers).toContain('API_P95_HIGH');
  });
});
