import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
@Injectable()
export class IntegrationsRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async list(userId: string) { return (await this.db.query(`SELECT id,"providerId",status,scopes,"consentVersion","lastSyncAt" FROM "IntegrationConnection" WHERE "userId"=$1::uuid`, [userId])).rows; }
  async connection(userId: string, id: string) { return (await this.db.query(`SELECT * FROM "IntegrationConnection" WHERE id=$1::uuid AND "userId"=$2::uuid`, [id,userId])).rows[0] ?? null; }
  async upsert(userId: string, providerId: string, cipher: string, scopes: string[], consentVersion: string) { return (await this.db.query(`INSERT INTO "IntegrationConnection" ("userId","providerId",status,"encryptedTokenCipher",scopes,"consentVersion") VALUES ($1::uuid,$2,'CONNECTED',$3,$4::jsonb,$5) ON CONFLICT ("userId","providerId") DO UPDATE SET status='CONNECTED',"encryptedTokenCipher"=EXCLUDED."encryptedTokenCipher",scopes=EXCLUDED.scopes,"consentVersion"=EXCLUDED."consentVersion","updatedAt"=CURRENT_TIMESTAMP RETURNING id,"providerId",status,scopes`, [userId,providerId,cipher,JSON.stringify(scopes),consentVersion])).rows[0]; }
  async revoke(userId: string, id: string) { return (await this.db.query(`UPDATE "IntegrationConnection" SET status='DISCONNECTED',"encryptedTokenCipher"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid AND "userId"=$2::uuid RETURNING id`, [id,userId])).rows[0] ?? null; }
  async markWebhook(providerId: string, eventId: string, valid: boolean) { return (await this.db.query(`INSERT INTO "IntegrationWebhookEvent" ("providerId","externalEventId","signatureValid","processedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP) ON CONFLICT ("externalEventId") DO NOTHING RETURNING id`, [providerId,eventId,valid])).rows[0] ?? null; }
  async listConsents(userId: string) { return (await this.db.query(`SELECT id,"providerId","dataCategory",direction,purpose,"consentVersion",status,"grantedAt","revokedAt",source FROM "HealthPlatformConsent" WHERE "userId"=$1::uuid ORDER BY "createdAt" DESC`, [userId])).rows; }
  async grantConsent(input: { userId: string; providerId: string; dataCategory: string; direction: string; purpose: string; consentVersion: string; source: string }) {
    await this.db.query(`UPDATE "HealthPlatformConsent" SET status='REVOKED',"revokedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1::uuid AND "providerId"=$2 AND "dataCategory"=$3 AND direction=$4 AND status='GRANTED'`, [input.userId,input.providerId,input.dataCategory,input.direction]);
    return (await this.db.query(`INSERT INTO "HealthPlatformConsent" ("userId","providerId","dataCategory",direction,purpose,"consentVersion",status,source) VALUES ($1::uuid,$2,$3,$4,$5,$6,'GRANTED',$7) RETURNING id,"providerId","dataCategory",direction,status`, [input.userId,input.providerId,input.dataCategory,input.direction,input.purpose,input.consentVersion,input.source])).rows[0];
  }
  async revokeConsent(userId: string, providerId: string, category?: string) {
    return (await this.db.query(`UPDATE "HealthPlatformConsent" SET status='REVOKED',"revokedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1::uuid AND "providerId"=$2 AND status='GRANTED' ${category ? 'AND "dataCategory"=$3' : ''} RETURNING id`, category ? [userId,providerId,category] : [userId,providerId])).rows;
  }
}
