import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class OwnerAdminRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async resolveSession(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.db.query<{ userId: string; role: string; mfaVerifiedAt: Date | null }>(
      'SELECT "userId", "role", "mfaVerifiedAt" FROM "Session" WHERE "tokenHash" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now()',
      [tokenHash],
    );
    return result.rows[0];
  }

  /** Authoritative MFA path: active OwnerMfaCredential (legacy OwnerMfaChallenge is not trusted). */
  async hasVerifiedMfa(userId: string) {
    const result = await this.db.query<{ verified: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM "OwnerMfaCredential"
         WHERE "userId" = $1 AND status = 'ACTIVE' AND "disabledAt" IS NULL
       ) AS verified`,
      [userId],
    );
    return result.rows[0]?.verified === true;
  }

  async recordAudit(userId: string, action: string, metadata: Record<string, unknown>) {
    await this.db.query('INSERT INTO "OwnerAuditEvent" ("userId", "action", "metadata") VALUES ($1, $2, $3::jsonb)', [userId, action, JSON.stringify(metadata)]);
  }

  async overviewMetrics() {
    const result = await this.db.query<{ users: string; activeSessions: string; auditEvents: string }>(
      'SELECT (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "Session" WHERE "revokedAt" IS NULL AND "expiresAt" > now()) AS "activeSessions", (SELECT count(*) FROM "OwnerAuditEvent") AS "auditEvents"',
    );
    const row = result.rows[0] ?? { users: '0', activeSessions: '0', auditEvents: '0' };
    return { users: Number(row.users), activeSessions: Number(row.activeSessions), auditEvents: Number(row.auditEvents) };
  }

  async searchUsers(query: string) {
    const result = await this.db.query<{
      id: string;
      email: string | null;
      username: string | null;
      accountRole: string;
      createdAt: string;
    }>(
      `SELECT id, email, username, COALESCE("accountRole", 'USER') AS "accountRole", "createdAt"
       FROM "User"
       WHERE lower(coalesce(email, '')) LIKE lower($1)
          OR lower(coalesce(username, '')) LIKE lower($1)
       ORDER BY "createdAt" DESC
       LIMIT 20`,
      [`%${query}%`],
    );
    return result.rows;
  }

  async recordSupportAccess(userId: string, reason: string, ttlMinutes: number) {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    await this.db.query('INSERT INTO "OwnerAuditEvent" ("userId", "action", "metadata") VALUES ($1, $2, $3::jsonb)', [userId, 'support.access.granted', JSON.stringify({ reason, ttlMinutes, expiresAt })]);
    return { expiresAt };
  }

  async listCatalog() {
    const result = await this.db.query<{ id: string; canonicalName: string; unit: string; caloriesPer100g: string; proteinPer100g: string }>('SELECT id, "canonicalName", unit, "caloriesPer100g", "proteinPer100g" FROM "Product" ORDER BY "createdAt" DESC LIMIT 100');
    return result.rows.map((row) => ({ ...row, caloriesPer100g: Number(row.caloriesPer100g), proteinPer100g: Number(row.proteinPer100g) }));
  }

  async createCatalog(userId: string, product: { canonicalName: string; unit: string; caloriesPer100g: number; proteinPer100g: number }) {
    const result = await this.db.query<{ id: string }>('INSERT INTO "Product" ("canonicalName", unit, "caloriesPer100g", "proteinPer100g") VALUES ($1, $2, $3, $4) RETURNING id', [product.canonicalName, product.unit, product.caloriesPer100g, product.proteinPer100g]);
    await this.recordAudit(userId, 'owner.catalog.created', { productId: result.rows[0].id, canonicalName: product.canonicalName });
    return { id: result.rows[0].id, ...product };
  }

  async listFeatureFlags() { const result = await this.db.query<{ key: string; enabled: boolean; updatedAt: string }>('SELECT key,enabled,"updatedAt" FROM "FeatureFlag" ORDER BY key'); return result.rows; }
  async setFeatureFlag(userId: string, key: string, enabled: boolean) { await this.db.query('INSERT INTO "FeatureFlag" (key,enabled,"updatedBy") VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled,"updatedBy"=EXCLUDED."updatedBy","updatedAt"=now()',[key,enabled,userId]); await this.recordAudit(userId,'owner.feature_flag.updated',{ key, enabled }); return (await this.db.query<{ key: string; enabled: boolean; updatedAt: string }>('SELECT key,enabled,"updatedAt" FROM "FeatureFlag" WHERE key=$1',[key])).rows[0]; }
}
