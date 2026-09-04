import { Injectable } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { computeBriefContentHash, type BriefApprovalRecord, isApprovalForCurrentBrief } from '../domain/recipe-synthesis-brief-approval.policy';
import type { SynthesisBrief } from '../domain/recipe-knowledge-synthesis.policy';
import { briefIdToStorageUuid } from '../domain/brief-identity';
import { mapRecipeSynthesisBriefRow } from './recipe-synthesis-brief.mapper';

@Injectable()
export class RecipeSynthesisBriefApprovalService {
  constructor(private readonly db: PrismaService) {}

  async approveExact(brief: SynthesisBrief, expectedContentHash: string, actorId: string, approvedAt = new Date()): Promise<BriefApprovalRecord> {
    const callerHash = computeBriefContentHash(brief);
    const briefUuid = briefIdToStorageUuid(brief.briefId);
    return this.db.withTransaction(async (tx) => {
      const current = await loadCurrentBrief(tx, brief.briefId, true);
      if (callerHash !== expectedContentHash) throw new Error('BRIEF_CONTENT_HASH_MISMATCH');
      if (computeBriefContentHash(current) !== expectedContentHash) throw new Error('BRIEF_PERSISTED_CONTENT_HASH_MISMATCH');
      await tx(`INSERT INTO "RecipeSynthesisBriefApproval" ("briefId","briefContentHash","decision","actorId","approvedAt") VALUES ($1::uuid,$2,'APPROVE',$3,$4::timestamptz) ON CONFLICT ("briefId","briefContentHash","decision") DO NOTHING`, [briefUuid, expectedContentHash, actorId, approvedAt.toISOString()]);
      await tx(`UPDATE "RecipeSynthesisBrief" SET "approvalState"='OWNER_APPROVED',"status"='APPROVED_FOR_SYNTHESIS',"updatedAt"=now() WHERE "id"=$1::uuid`, [briefUuid]);
      return { briefId: brief.briefId, briefContentHash: expectedContentHash, decision: 'APPROVE', actorId, approvedAt: approvedAt.toISOString() };
    });
  }

  async hasCurrentApproval(brief: SynthesisBrief): Promise<boolean> {
    return this.db.withTransaction(async (tx) => {
      const current = await loadCurrentBrief(tx, brief.briefId, true);
      if (computeBriefContentHash(brief) !== computeBriefContentHash(current)) return false;
      if (current.status !== 'APPROVED_FOR_SYNTHESIS' || current.approvalState !== 'OWNER_APPROVED') return false;
      const rows = await tx<BriefApprovalRecord>(`SELECT "briefId","briefContentHash","decision","actorId","approvedAt" FROM "RecipeSynthesisBriefApproval" WHERE "briefId"=$1::uuid AND "decision"='APPROVE' ORDER BY "approvedAt" DESC LIMIT 1`, [briefIdToStorageUuid(brief.briefId)]);
      const record = rows.rows[0] ? { ...rows.rows[0], briefId: brief.briefId } : null;
      return isApprovalForCurrentBrief(current, record);
    });
  }
}

async function loadCurrentBrief(query: SqlQuery, briefId: string, lock: boolean): Promise<SynthesisBrief> {
  const suffix = lock ? ' FOR UPDATE' : '';
  const result = await query<Record<string, unknown>>(`SELECT * FROM "RecipeSynthesisBrief" WHERE "id"=$1::uuid${suffix}`, [briefIdToStorageUuid(briefId)]);
  const row = result.rows[0];
  if (!row) throw new Error('SYNTHESIS_BRIEF_NOT_FOUND');
  return mapRecipeSynthesisBriefRow(briefId, row);
}
