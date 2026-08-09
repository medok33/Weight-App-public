import { describe, expect, it } from 'vitest';
import {
  assertConsent,
  filterHealthDataForAi,
  validateConsentGrant,
} from '../domain/integrations.policy';
import { evaluateOfficialFeedReadiness, SandboxOfficialFeedAdapter } from '../domain/official-retailer-feed.adapter';

describe('health platform consent STEP_187', () => {
  it('requires granular grant and isolates AI payload', () => {
    expect(() =>
      validateConsentGrant({
        userId: 'u1',
        providerId: 'apple_health',
        dataCategory: 'weight',
        direction: 'READ',
        purpose: 'progress',
        consentVersion: 'v1',
        source: 'user',
      }),
    ).not.toThrow();
    expect(() =>
      validateConsentGrant({
        userId: 'u1',
        providerId: 'apple_health',
        dataCategory: 'all' as never,
        direction: 'READ',
        purpose: 'x',
        consentVersion: 'v1',
        source: 'user',
      }),
    ).toThrow();
    const consents = [
      {
        userId: 'u1',
        providerId: 'apple_health',
        dataCategory: 'activity' as const,
        direction: 'READ' as const,
        purpose: 'progress',
        consentVersion: 'v1',
        source: 'user',
        status: 'GRANTED' as const,
      },
    ];
    expect(() => assertConsent(consents, 'u1', 'apple_health', 'weight', 'READ')).toThrow();
    expect(filterHealthDataForAi(consents, { activity: 1, weight: 90, familyId: 'f' })).toEqual({
      activity: 1,
    });
  });
});

describe('official retailer feed STEP_188', () => {
  it('keeps sandbox contract and blocks unofficial access', async () => {
    const adapter = new SandboxOfficialFeedAdapter();
    const page = await adapter.fetchPage();
    expect(page.observations.length).toBeGreaterThan(0);
    expect(evaluateOfficialFeedReadiness('sandbox', [{ providerId: 'sandbox' }])).toEqual({
      status: 'PARTIAL',
      reason: 'OFFICIAL_RETAILER_FEED_ACCESS_REQUIRED',
    });
  });
});
