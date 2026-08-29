import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { computeBriefContentHash, type BriefApprovalRecord, isApprovalForCurrentBrief } from '../domain/recipe-synthesis-brief-approval.policy';
import type { SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';

@Injectable()
export class RecipeSynthesisBriefApprovalService {
  constructor(private readonly db: PrismaService) {}

  async approveExact(brief: SynthesisBrief, expectedContentHash: string, actorId: string, approvedAt = new Date()): Promise<BriefApprovalRecord> {
    const currentHash = computeBriefContentHash(brief);
    if (currentHash !== expectedContentHash) throw new Error('BRIEF_CONTENT_HASH_MISMATCH');
    const briefUuid = toUuid(brief.briefId);
    await this.db.query(`INSERT INTO "RecipeSynthesisBriefApproval" ("briefId","briefContentHash","decision","actorId","approvedAt") VALUES ($1::uuid,$2,'APPROVE',$3,$4::timestamptz) ON CONFLICT ("briefId","briefContentHash","decision") DO NOTHING`, [briefUuid, currentHash, actorId, approvedAt.toISOString()]);
    await this.db.query(`UPDATE "RecipeSynthesisBrief" SET "approvalState"='OWNER_APPROVED',"status"='APPROVED_FOR_SYNTHESIS',"updatedAt"=now() WHERE "id"=$1::uuid`, [briefUuid]);
    return { briefId: brief.briefId, briefContentHash: currentHash, decision: 'APPROVE', actorId, approvedAt: approvedAt.toISOString() };
  }

  async hasCurrentApproval(brief: SynthesisBrief): Promise<boolean> {
    const rows = await this.db.query<BriefApprovalRecord>(`SELECT "briefId","briefContentHash","decision","actorId","approvedAt" FROM "RecipeSynthesisBriefApproval" WHERE "briefId"=$1::uuid AND "decision"='APPROVE' ORDER BY "approvedAt" DESC LIMIT 1`, [toUuid(brief.briefId)]);
    return isApprovalForCurrentBrief(brief, rows.rows[0] ?? null);
  }
}

function toUuid(value: string): string { const hex = value.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`; }
