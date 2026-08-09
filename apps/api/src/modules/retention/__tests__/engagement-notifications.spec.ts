import { describe, expect, it } from 'vitest';
import {
  buildReturnAfterBreak,
  composePrivacySafeCopy,
  resolveDeliveryDecision,
  shouldDeliver,
} from '../domain/engagement-notifications.policy';

describe('notifications privacy and delivery STEP_184', () => {
  it('strips weight and sensitive words from notification copy', () => {
    const copy = composePrivacySafeCopy('progress', {
      title: 'Weight is 96 kg',
      body: 'diagnosis and payment details for family member ai',
    });
    expect(copy.title.toLowerCase()).not.toContain('96');
    expect(copy.title.toLowerCase()).not.toContain('kg');
    expect(copy.body.toLowerCase()).not.toMatch(/diagnos|payment|family member|ai\b/);
  });

  it('defers during quiet hours instead of losing the notification', () => {
    const prefs = {
      userId: 'u1',
      channels: { in_app: true, email: false, push: false },
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      categoryOpts: { meal: false },
    };
    const quiet = new Date('2026-07-22T23:30:00');
    const deferred = resolveDeliveryDecision(prefs, 'progress', 'in_app', quiet);
    expect(deferred.action).toBe('defer');
    expect(deferred.deferUntil).toBeInstanceOf(Date);
    expect(shouldDeliver(prefs, 'meal', 'in_app', quiet)).toBe(false);
    expect(resolveDeliveryDecision(prefs, 'security', 'email', quiet).action).toBe('deliver');
    expect(resolveDeliveryDecision(prefs, 'meal', 'in_app', quiet).action).toBe('skip');
  });
});

describe('return after break STEP_185', () => {
  it('is welcoming, preserves totals, and requires safety review when needed', () => {
    const state = {
      userId: 'u1',
      successfulDaysTotal: 40,
      bestStreakDays: 12,
      currentStreakDays: 3,
      paused: true,
      lastActiveOn: '2026-06-22',
      remindersEnabled: true,
    };
    const result = buildReturnAfterBreak(state, '2026-07-22', { unsafeCalorieTarget: true });
    expect(result.message.toLowerCase()).toContain('welcome');
    expect(result.message.toLowerCase()).not.toMatch(/failed|broken|ruined|burned|сгорела|провалили/);
    expect(result.daysAway).toBe(30);
    expect(result.requireSafetyReview).toBe(true);
    expect(result.nextSmallAction).toBe('recalculate_if_unsafe');
    expect(result.successfulDaysTotal).toBe(40);
    expect(result.bestStreakDays).toBe(12);
  });
});
