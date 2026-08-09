import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSupportAccess } from '../domain/owner-admin.policy';

test('support access reason and TTL are bounded', () => {
  assert.deepEqual(validateSupportAccess('Investigate support ticket', 15), { reason: 'Investigate support ticket', ttlMinutes: 15 });
  assert.throws(() => validateSupportAccess('bad', 15), /SUPPORT_REASON_INVALID/);
  assert.throws(() => validateSupportAccess('Valid reason', 120), /SUPPORT_TTL_INVALID/);
});
