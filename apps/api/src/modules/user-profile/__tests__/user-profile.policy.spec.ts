import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateGoalInput, validateProfileInput } from '../domain/user-profile.policy';

test('profile validation accepts complete input', () => {
  const profile = validateProfileInput({
    displayName: 'Alex',
    ageYears: 30,
    heightCm: 180,
    weightKg: 80,
    activityLevel: 'moderate',
    locale: 'en',
  });
  assert.equal(profile.displayName, 'Alex');
  assert.equal(profile.locale, 'en');
});

test('profile validation rejects invalid age', () => {
  assert.throws(
    () =>
      validateProfileInput({
        displayName: 'Alex',
        ageYears: 10,
        heightCm: 180,
        weightKg: 80,
        activityLevel: 'moderate',
      }),
    /PROFILE_INVALID_AGE/,
  );
});

test('goal validation accepts target weight', () => {
  const goal = validateGoalInput({ kind: 'lose_weight', target: 75, unit: 'kg' });
  assert.equal(goal.kind, 'lose_weight');
});
