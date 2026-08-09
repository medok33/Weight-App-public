import { describe, expect, it } from 'vitest';
import { scanTextForSecrets } from '../../src/modules/audit-security/domain/audit-security.policy';

describe('STEP_159 secret scanning gate', () => {
  it('flags private keys and rejects leaking matched values', () => {
    const findings = scanTextForSecrets(
      'leak.txt',
      '-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\napi_key="abcdefghijklmnopqrstuv"',
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(findings)).not.toMatch(/MII/);
    expect(JSON.stringify(findings)).not.toMatch(/abcdefghijklmnopqrstuv/);
  });
});
