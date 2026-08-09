import { Inject, Injectable } from '@nestjs/common';
import { AuditSecurityService } from '../../audit-security/application/audit-security.service';
import { encryptToken, verifyWebhookSignature, validatePartnerFeed, validateConsentGrant, type HealthDataCategory } from '../domain/integrations.policy';
import type { IntegrationAdapter } from '../domain/integrations.types';
import { IntegrationsRepository } from '../infrastructure/integrations.repository';
@Injectable()
export class IntegrationsService {
  private readonly adapters = new Map<string, IntegrationAdapter>();
  constructor(@Inject(IntegrationsRepository) private readonly repository: IntegrationsRepository, @Inject(AuditSecurityService) private readonly audit: AuditSecurityService) {}
  register(feed: { partnerId?: string; fetchPrices?: unknown }) { return validatePartnerFeed(feed); }
  registerAdapter(adapter: IntegrationAdapter) { this.adapters.set(adapter.providerId, adapter); }
  list(userId: string) { return this.repository.list(userId); }
  async connect(userId: string, providerId: string, consentVersion: string, input: unknown) {
    if (!consentVersion) throw new Error('INTEGRATION_CONSENT_REQUIRED');
    const adapter = this.adapters.get(providerId); if (!adapter) throw new Error('INTEGRATION_PROVIDER_UNAVAILABLE');
    const connected = await adapter.connect(input); const result = await this.repository.upsert(userId, providerId, encryptToken(connected.token), connected.scopes ?? [], consentVersion);
    await this.audit.appendEvent({ actorUserId: userId, action: 'integration.connect', entityType: 'IntegrationConnection', entityId: result.id, metadata: { providerId } }); return result;
  }
  async disconnect(userId: string, connectionId: string) { const connection = await this.repository.connection(userId, connectionId); if (!connection) throw new Error('INTEGRATION_FORBIDDEN'); await this.adapters.get(connection.providerId)?.disconnect(); const result = await this.repository.revoke(userId, connectionId); await this.audit.appendEvent({ actorUserId: userId, action: 'integration.disconnect', entityType: 'IntegrationConnection', entityId: connectionId, metadata: { providerId: connection.providerId } }); return result; }
  async sync(userId: string, connectionId: string) { const connection = await this.repository.connection(userId, connectionId); if (!connection) throw new Error('INTEGRATION_FORBIDDEN'); return this.adapters.get(connection.providerId)?.sync(); }
  async webhook(providerId: string, eventId: string, raw: string, signature: string, secret: string) { const valid = verifyWebhookSignature(raw, secret, signature); if (!valid) throw new Error('INTEGRATION_SIGNATURE_INVALID'); if (!await this.repository.markWebhook(providerId,eventId,true)) throw new Error('INTEGRATION_WEBHOOK_REPLAY'); return this.adapters.get(providerId)?.handleWebhook(raw); }
  listConsents(userId: string) { return this.repository.listConsents(userId); }
  async grantConsent(userId: string, input: { providerId?: string; dataCategory?: string; direction?: 'READ' | 'WRITE'; purpose?: string; consentVersion?: string; source?: string }) {
    const grant = {
      userId,
      providerId: input.providerId,
      dataCategory: input.dataCategory as HealthDataCategory | undefined,
      direction: input.direction,
      purpose: input.purpose,
      consentVersion: input.consentVersion,
      source: input.source ?? 'user',
    };
    validateConsentGrant(grant);
    const result = await this.repository.grantConsent({
      userId: grant.userId,
      providerId: grant.providerId,
      dataCategory: grant.dataCategory,
      direction: grant.direction,
      purpose: grant.purpose,
      consentVersion: grant.consentVersion,
      source: grant.source,
    });
    await this.audit.appendEvent({ actorUserId: userId, action: 'health_consent.grant', entityType: 'HealthPlatformConsent', entityId: result.id, metadata: { providerId: grant.providerId, category: grant.dataCategory } });
    return result;
  }
  async revokeConsent(userId: string, providerId: string, category?: string) {
    const result = await this.repository.revokeConsent(userId, providerId, category);
    await this.audit.appendEvent({ actorUserId: userId, action: 'health_consent.revoke', entityType: 'HealthPlatformConsent', entityId: providerId, metadata: { providerId, category: category ?? 'all' } });
    return result;
  }
}
