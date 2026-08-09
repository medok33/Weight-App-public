import { describe, expect, it } from 'vitest';
import { LegalConsentService } from '../application/legal-consent.service';
import { checkLegalContentVersions, REQUIRED_LEGAL_DOCUMENTS } from '../domain/legal-consent.policy';

describe('legal-consent STEP_166', () => {
  it('requires terms and privacy consents', () => {
    const service = new LegalConsentService();
    expect(service.hasRequired(['terms', 'privacy'])).toBe(true);
    expect(service.hasRequired(['terms'])).toBe(false);
  });

  it('passes when published catalog matches required versions', () => {
    const result = checkLegalContentVersions([...REQUIRED_LEGAL_DOCUMENTS]);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('fails when a required document is missing or outdated', () => {
    const missing = checkLegalContentVersions(REQUIRED_LEGAL_DOCUMENTS.filter((d) => d.kind !== 'privacy'));
    expect(missing.ok).toBe(false);
    expect(missing.missing).toContain('privacy');

    const outdated = checkLegalContentVersions(
      REQUIRED_LEGAL_DOCUMENTS.map((d) => (d.kind === 'terms' ? { ...d, version: '0.9.0' } : d)),
    );
    expect(outdated.ok).toBe(false);
    expect(outdated.outdated).toContain('terms');
  });
});
