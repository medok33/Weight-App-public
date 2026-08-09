import { Inject, Injectable } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import type {
  AdaptationApplyResult,
  AdaptationSessionSnapshot,
  GoalImpactSnapshot,
  WorkoutAdaptationCommandAction,
  WorkoutAdaptationCommandRecord,
  WorkoutAdaptationIntent,
  WorkoutAdaptationRecord,
} from '../domain/workout-adaptation.types';

type AdaptationRow = {
  id: string;
  userId: string;
  workoutPlanId: string | null;
  workoutSessionId: string;
  intent: WorkoutAdaptationIntent;
  selectedOptionCode: string;
  policyVersion: string;
  catalogReleaseId: string | null;
  sessionVersionBefore: number;
  sessionVersionAfter: number;
  beforeSnapshot: AdaptationSessionSnapshot;
  afterSnapshot: AdaptationSessionSnapshot;
  goalImpactSnapshot: GoalImpactSnapshot;
  status: 'APPLIED' | 'UNDONE';
  idempotencyKey: string | null;
  createdAt: Date | string;
  undoneAt: Date | string | null;
};

type CommandRow = {
  id: string;
  userId: string;
  workoutSessionId: string;
  action: WorkoutAdaptationCommandAction;
  idempotencyKey: string;
  requestHash: string;
  adaptationId: string | null;
  responseSnapshot: AdaptationApplyResult;
  createdAt: Date | string;
};

function asRecord(row: AdaptationRow): WorkoutAdaptationRecord {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    undoneAt: row.undoneAt ? new Date(row.undoneAt).toISOString() : null,
  };
}

function asCommand(row: CommandRow): WorkoutAdaptationCommandRecord {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

@Injectable()
export class WorkoutAdaptationRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async findLatestApplied(sessionId: string, query: SqlQuery = this.db.query.bind(this.db) as SqlQuery) {
    const result = await query<AdaptationRow>(
      `SELECT * FROM "WorkoutAdaptation"
       WHERE "workoutSessionId" = $1 AND status = 'APPLIED'
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [sessionId],
    );
    return result.rows[0] ? asRecord(result.rows[0]) : null;
  }

  async listBySession(sessionId: string, limit = 50): Promise<WorkoutAdaptationRecord[]> {
    const result = await this.db.query<AdaptationRow>(
      `SELECT * FROM "WorkoutAdaptation"
       WHERE "workoutSessionId" = $1
       ORDER BY "createdAt" DESC
       LIMIT $2`,
      [sessionId, limit],
    );
    return result.rows.map(asRecord);
  }

  async insertApplied(
    input: Omit<WorkoutAdaptationRecord, 'id' | 'createdAt' | 'undoneAt' | 'status'>,
    query: SqlQuery = this.db.query.bind(this.db) as SqlQuery,
  ): Promise<WorkoutAdaptationRecord> {
    const result = await query<AdaptationRow>(
      `INSERT INTO "WorkoutAdaptation" (
         "userId", "workoutPlanId", "workoutSessionId", intent, "selectedOptionCode",
         "policyVersion", "catalogReleaseId", "sessionVersionBefore", "sessionVersionAfter",
         "beforeSnapshot", "afterSnapshot", "goalImpactSnapshot", status, "idempotencyKey"
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,'APPLIED',$13
       ) RETURNING *`,
      [
        input.userId,
        input.workoutPlanId,
        input.workoutSessionId,
        input.intent,
        input.selectedOptionCode,
        input.policyVersion,
        input.catalogReleaseId,
        input.sessionVersionBefore,
        input.sessionVersionAfter,
        JSON.stringify(input.beforeSnapshot),
        JSON.stringify(input.afterSnapshot),
        JSON.stringify(input.goalImpactSnapshot),
        input.idempotencyKey,
      ],
    );
    return asRecord(result.rows[0]!);
  }

  async markUndone(id: string, query: SqlQuery = this.db.query.bind(this.db) as SqlQuery): Promise<WorkoutAdaptationRecord | null> {
    const result = await query<AdaptationRow>(
      `UPDATE "WorkoutAdaptation"
       SET status = 'UNDONE', "undoneAt" = now()
       WHERE id = $1 AND status = 'APPLIED'
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? asRecord(result.rows[0]) : null;
  }

  async findCommand(
    userId: string,
    sessionId: string,
    action: WorkoutAdaptationCommandAction,
    idempotencyKey: string,
    query: SqlQuery = this.db.query.bind(this.db) as SqlQuery,
  ): Promise<WorkoutAdaptationCommandRecord | null> {
    const result = await query<CommandRow>(
      `SELECT * FROM "WorkoutAdaptationCommand"
       WHERE "userId" = $1
         AND "workoutSessionId" = $2
         AND action = $3
         AND "idempotencyKey" = $4
       LIMIT 1`,
      [userId, sessionId, action, idempotencyKey],
    );
    return result.rows[0] ? asCommand(result.rows[0]) : null;
  }

  async insertCommand(
    input: Omit<WorkoutAdaptationCommandRecord, 'id' | 'createdAt'>,
    query: SqlQuery = this.db.query.bind(this.db) as SqlQuery,
  ): Promise<WorkoutAdaptationCommandRecord> {
    const result = await query<CommandRow>(
      `INSERT INTO "WorkoutAdaptationCommand" (
         "userId", "workoutSessionId", action, "idempotencyKey", "requestHash",
         "adaptationId", "responseSnapshot"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING *`,
      [
        input.userId,
        input.workoutSessionId,
        input.action,
        input.idempotencyKey,
        input.requestHash,
        input.adaptationId,
        JSON.stringify(input.responseSnapshot),
      ],
    );
    return asCommand(result.rows[0]!);
  }
}
