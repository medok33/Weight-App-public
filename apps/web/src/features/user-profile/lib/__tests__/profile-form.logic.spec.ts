import { describe, expect, it } from 'vitest';
import type { ProfileFormValues } from '../../model/user-profile.types';
import { isProfileFormDirty, serializeProfileForm, validateProfileForm } from '../profile-form.logic';

function baseForm(overrides: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    displayName: 'Test User',
    ageYears: '30',
    heightCm: '175',
    weightKg: '80',
    goalKind: 'lose_weight',
    goalTarget: '72',
    targetDate: '',
    activityLevel: 'moderate',
    trainingLevel: '',
    workoutsPerWeek: '',
    allergenCodes: [],
    dietaryCodes: [],
    intoleranceCodes: [],
    equipmentCodes: [],
    dietaryPreferencesNote: '',
    foodRestrictionsNote: '',
    equipmentNote: '',
    locale: 'ru',
    legacyStructureConfirmed: true,
    ...overrides,
  };
}

describe('profile-form.logic', () => {
  it('accepts a valid form', () => {
    expect(validateProfileForm(baseForm())).toEqual({});
  });

  it('requires name length >= 2', () => {
    expect(validateProfileForm(baseForm({ displayName: 'A' })).displayName).toBe(true);
    expect(validateProfileForm(baseForm({ displayName: '  ' })).displayName).toBe(true);
  });

  it('validates age / height / weight ranges', () => {
    expect(validateProfileForm(baseForm({ ageYears: '13' })).ageYears).toBe(true);
    expect(validateProfileForm(baseForm({ heightCm: '100' })).heightCm).toBe(true);
    expect(validateProfileForm(baseForm({ weightKg: '10' })).weightKg).toBe(true);
  });

  it('requires goal kind and target > 0', () => {
    expect(validateProfileForm(baseForm({ goalKind: '' })).goalKind).toBe(true);
    expect(validateProfileForm(baseForm({ goalTarget: '0' })).goalTarget).toBe(true);
    expect(validateProfileForm(baseForm({ goalTarget: '70.5' })).goalTarget).toBeUndefined();
  });

  it('allows empty workoutsPerWeek and rejects out of range', () => {
    expect(validateProfileForm(baseForm({ workoutsPerWeek: '' })).workoutsPerWeek).toBeUndefined();
    expect(validateProfileForm(baseForm({ workoutsPerWeek: '15' })).workoutsPerWeek).toBe(true);
  });

  it('detects dirty via serialize', () => {
    const form = baseForm();
    const baseline = serializeProfileForm(form);
    expect(isProfileFormDirty(form, baseline)).toBe(false);
    expect(isProfileFormDirty(baseForm({ displayName: 'Other' }), baseline)).toBe(true);
    expect(isProfileFormDirty(form, null)).toBe(false);
  });

  it('trims displayName for dirty comparison', () => {
    const form = baseForm({ displayName: 'Test User' });
    const baseline = serializeProfileForm(form);
    expect(isProfileFormDirty(baseForm({ displayName: '  Test User  ' }), baseline)).toBe(false);
  });
});
