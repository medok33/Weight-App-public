import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { computeBriefContentHash, type BriefApprovalRecord, isApprovalForCurrentBrief } from '../domain/recipe-synthesis-brief-approval.policy';
import type { SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';
import { briefIdToStorageUuid } from '../domain/brief-identity';

@Injectable()
export class RecipeSynthesisBriefApprovalService {
  constructor(private readonly db: PrismaService) {}

  async approveExact(brief: SynthesisBrief, expectedContentHash: string, actorId: string, approvedAt = new Date()): Promise<BriefApprovalRecord> {
    const currentHash = computeBriefContentHash(brief);
    if (currentHash !== expectedContentHash) throw new Error('BRIEF_CONTENT_HASH_MISMATCH');
    const briefUuid = briefIdToStorageUuid(brief.briefId);
    await this.db.query(`INSERT INTO "RecipeSynthesisBriefApproval" ("briefId","briefContentHash","decision","actorId","approvedAt") VALUES ($1::uuid,$2,'APPROVE',$3,$4::timestamptz) ON CONFLICT ("briefId","briefContentHash","decision") DO NOTHING`, [briefUuid, currentHash, actorId, approvedAt.toISOString()]);
    await this.db.query(`UPDATE "RecipeSynthesisBrief" SET "approvalState"='OWNER_APPROVED',"status"='APPROVED_FOR_SYNTHESIS',"updatedAt"=now() WHERE "id"=$1::uuid`, [briefUuid]);
    return { briefId: brief.briefId, briefContentHash: currentHash, decision: 'APPROVE', actorId, approvedAt: approvedAt.toISOString() };
  }

  async hasCurrentApproval(brief: SynthesisBrief): Promise<boolean> {
    const rows = await this.db.query<BriefApprovalRecord>(`SELECT "briefId","briefContentHash","decision","actorId","approvedAt" FROM "RecipeSynthesisBriefApproval" WHERE "briefId"=$1::uuid AND "decision"='APPROVE' ORDER BY "approvedAt" DESC LIMIT 1`, [briefIdToStorageUuid(brief.briefId)]);
    const record = rows.rows[0] ? { ...rows.rows[0], briefId: brief.briefId } : null;
    return isApprovalForCurrentBrief(brief, record);
  }
}
