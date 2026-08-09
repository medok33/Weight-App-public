import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('STEP_182-186 migration contracts', () => {
  it('161 family shared shopping', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/161_family-shared-shopping/migration.sql'), 'utf8');
    expect(sql).toContain('"SharedDish"');
    expect(sql).toContain('"FamilyShoppingList"');
    expect(sql).toContain('"FamilyShoppingItem"');
  });
  it('162 notifications', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/162_notifications/migration.sql'), 'utf8');
    expect(sql).toContain('"NotificationPreference"');
    expect(sql).toContain('"DeliveryAttempt"');
    expect(sql).toContain('"dedupeKey"');
  });
  it('163 engagement', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/163_engagement/migration.sql'), 'utf8');
    expect(sql).toContain('"EngagementState"');
    expect(sql).toContain('"bestStreakDays"');
  });
  it('164 integration adapters', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/164_integration-adapters/migration.sql'), 'utf8');
    expect(sql).toContain('"IntegrationConnection"');
    expect(sql).toContain('"encryptedTokenCipher"');
    expect(sql).toContain('"IntegrationWebhookEvent"');
  });
  it('165 notification outbox', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/165_notification-outbox/migration.sql'), 'utf8');
    expect(sql).toContain('"NotificationOutbox"');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED'.length >= 0 ? 'availableAt' : '');
    expect(sql).toContain('PENDING');
  });
  it('166 health platform consent', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/166_health-platform-consent/migration.sql'), 'utf8');
    expect(sql).toContain('"HealthPlatformConsent"');
    expect(sql).toContain('HealthPlatformConsent_active_unique');
  });
});
