import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildOnboardingStatus,
  redactFeedbackForLog,
  validateFeedbackInput,
  validateOnboardingStepKey,
} from '../domain/retention.policy';
import { buildReturnAfterBreak, classifyProviderFailure, composePrivacySafeCopy, dedupeKey, recordEngagementDay, resolveDeliveryDecision } from '../domain/engagement-notifications.policy';
import type { BetaFeedbackRecord, BetaOnboardingStatus, NotificationCategory, NotificationChannel, NotificationPreferences } from '../domain/retention.types';
import { RetentionRepository } from '../infrastructure/retention.repository';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(@Inject(RetentionRepository) private readonly repository: RetentionRepository) {}

  async getOnboarding(userId: string): Promise<BetaOnboardingStatus> {
    if (!userId?.trim()) throw new Error('BETA_USER_INVALID');
    return buildOnboardingStatus(await this.repository.listCompletedSteps(userId));
  }

  async completeOnboardingStep(userId: string, stepKey: string): Promise<BetaOnboardingStatus> {
    if (!userId?.trim()) throw new Error('BETA_USER_INVALID');
    const key = validateOnboardingStepKey(stepKey);
    await this.repository.completeStep(userId, key);
    return this.getOnboarding(userId);
  }

  async submitFeedback(input: {
    userId: string;
    category?: string;
    message?: string;
    idempotencyKey?: string;
  }): Promise<{ feedback: BetaFeedbackRecord; duplicate: boolean }> {
    const validated = validateFeedbackInput(input);
    if (validated.userId !== input.userId) throw new Error('BETA_FEEDBACK_FORBIDDEN');
    const existing = await this.repository.findFeedbackByIdempotency(validated.idempotencyKey);
    if (existing) {
      if (existing.userId !== validated.userId) throw new Error('BETA_FEEDBACK_FORBIDDEN');
      return { feedback: existing, duplicate: true };
    }
    this.logger.log(JSON.stringify({ event: 'beta.feedback.submitted', ...redactFeedbackForLog(validated) }));
    const feedback = await this.repository.insertFeedback(validated);
    return { feedback, duplicate: false };
  }
  getNotificationPreferences(userId: string) { return this.repository.preferences(userId); }
  setNotificationPreferences(userId: string, preferences: Omit<NotificationPreferences, 'userId'>) { return this.repository.savePreferences({ ...preferences, userId }); }
  async enqueueNotification(userId: string, category: NotificationCategory, eventId: string, event: { title?: string; body?: string }) {
    const copy = composePrivacySafeCopy(category, event);
    const notification = await this.repository.enqueue(userId, category, copy.title, copy.body, dedupeKey(userId, category, eventId));
    return { notification, duplicate: !notification };
  }
  listInAppInbox(userId: string) { return this.repository.listInAppInbox(userId); }

  async processDelivery(userId: string, notificationId: string, channel: NotificationChannel, nowLocal = new Date()) {
    const prefs = await this.repository.preferences(userId);
    const notification = await this.repository.getNotification(userId, notificationId);
    if (!notification) throw new Error('NOTIFICATION_NOT_FOUND');
    const decision = resolveDeliveryDecision(prefs, notification.category as NotificationCategory, channel, nowLocal);
    if (decision.action === 'skip') {
      return this.repository.recordAttempt(notificationId, channel, 'SKIPPED', 1, decision.reason ?? 'CHANNEL_DISABLED');
    }
    const attempt = (await this.repository.countAttempts(notificationId, channel)) + 1;
    if (attempt > 3) {
      return this.repository.recordAttempt(notificationId, channel, 'RETRY_EXHAUSTED', attempt, 'RETRY_EXHAUSTED');
    }
    try {
      // In-app and email adapters are privacy-safe stubs; push remains future.
      if (channel === 'push' && !prefs.channels.push) {
        return this.repository.recordAttempt(notificationId, channel, 'SKIPPED', attempt, 'PUSH_DISABLED');
      }
      await this.repository.markDelivered(notificationId);
      return this.repository.recordAttempt(notificationId, channel, 'SENT', attempt, null);
    } catch (error) {
      return this.repository.recordAttempt(notificationId, channel, 'FAILED', attempt, classifyProviderFailure(error));
    }
  }

  async processOutboxItem(outboxId: string, nowLocal = new Date()) {
    const item = await this.repository.outboxContext(outboxId);
    if (!item || !item.userActive) {
      if (item) {
        await this.repository.recordAttempt(item.notificationId, item.channel, 'FAILED', item.attempts + 1, 'USER_INACTIVE');
        await this.repository.failOutbox(outboxId, item.attempts + 1, 'USER_INACTIVE', false);
      }
      return { notificationId: item?.notificationId, status: 'DEAD' };
    }
    const decision = resolveDeliveryDecision(await this.repository.preferences(item.userId), item.category, item.channel, nowLocal);
    if (decision.action === 'defer') {
      await this.repository.deferOutbox(outboxId, decision.deferUntil!);
      return { notificationId: item.notificationId, status: 'DEFERRED' };
    }
    if (decision.action === 'skip') {
      await this.repository.recordAttempt(item.notificationId, item.channel, 'SKIPPED', item.attempts + 1, decision.reason ?? null);
      await this.repository.completeOutbox(outboxId);
      return { notificationId: item.notificationId, status: 'SKIPPED' };
    }
    const attempt = item.attempts + 1;
    try {
      if (item.channel !== 'in_app') throw new Error('PROVIDER_NOT_CONFIGURED');
      await this.repository.markDelivered(item.notificationId);
      await this.repository.recordAttempt(item.notificationId, item.channel, 'SENT', attempt, null);
      await this.repository.completeOutbox(outboxId);
      return { notificationId: item.notificationId, status: 'SENT' };
    } catch (error) {
      const code = classifyProviderFailure(error);
      const exhausted = await this.repository.failOutbox(outboxId, attempt, code, code === 'RETRYABLE_PROVIDER_FAILURE');
      await this.repository.recordAttempt(item.notificationId, item.channel, exhausted ? 'RETRY_EXHAUSTED' : 'FAILED', attempt, code);
      return { notificationId: item.notificationId, status: exhausted ? 'RETRY_EXHAUSTED' : 'FAILED' };
    }
  }

  async getReturnContext(userId: string, options?: { planExpired?: boolean; unsafeCalorieTarget?: boolean }) {
    return buildReturnAfterBreak(await this.repository.engagement(userId), new Date().toISOString().slice(0, 10), options);
  }
  async recordActivityDay(userId: string, date: string) { return this.repository.saveEngagement(recordEngagementDay(await this.repository.engagement(userId), date)); }
  async setPause(userId: string, paused: boolean) { return this.repository.saveEngagement({ ...(await this.repository.engagement(userId)), paused }); }
  async setRemindersEnabled(userId: string, remindersEnabled: boolean) { return this.repository.saveEngagement({ ...(await this.repository.engagement(userId)), remindersEnabled }); }
}
