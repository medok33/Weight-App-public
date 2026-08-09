import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AUTH_PROVIDERS, isSupportedProvider } from '../../src/modules/auth/domain/auth.policy';

test('auth providers are explicit and SMS is excluded', () => {
  assert.deepEqual(AUTH_PROVIDERS, ['email', 'vk', 'telegram']);
  assert.equal(isSupportedProvider('sms'), false);
});
