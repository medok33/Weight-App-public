import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  WORKOUT_ENERGY_TIMING_POLICY_VERSION,
  type ExerciseEnergyTimingProfileDraftInput,
  type ExerciseEnergyTimingProfileRecord,
  type ExerciseEnergyTimingProfileStatus,
} from './workout-energy.types';
import {
  assertCanApproveTimingProfile,
  assertCanRetireTimingProfile,
  assertCanUpdateTimingDraft,
  assertDraftTimingMetadata,
  selectApprovedTimingProfile,
} from './exercise-energy-timing-profile.lifecycle';

type TimingProfileRow = {
  id: string;
  exerciseRevisionId: string;
  status: ExerciseEnergyTimingProfileStatus;
  timingMethod: string;
  secondsPerRep: string | number;
  sourceType: string;
  sourceReference: string;
  sourceVersion: string;
  policyVersion: string;
  enabledForCalculation: boolean;
  reviewedAt: Date | string | null;
  reviewedBy: string | null;
  approvedAt: Date | string | null;
  retiredAt: Date | string | null;
  retirementReason: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function mapRow(row: TimingProfileRow): ExerciseEnergyTimingProfileRecord {
  return {
    id: row.id,
    exerciseRevisionId: row.exerciseRevisionId,
    status: row.status,
    timingMethod: row.timingMethod as ExerciseEnergyTimingProfileRecord['timingMethod'],
    secondsPerRep: Number(row.secondsPerRep),
    sourceType: row.sourceType as ExerciseEnergyTimingProfileRecord['sourceType'],
    sourceReference: row.sourceReference,
    sourceVersion: row.sourceVersion,
    policyVersion: row.policyVersion,
    enabledForCalculation: row.enabledForCalculation,
    reviewedAt: asIso(row.reviewedAt),
    reviewedBy: row.reviewedBy,
    approvedAt: asIso(row.approvedAt),
    retiredAt: asIso(row.retiredAt),
    retirementReason: row.retirementReason,
    createdAt: asIso(row.createdAt)!,
    updatedAt: asIso(row.updatedAt)!,
  };
}

@Injectable()
export class ExerciseEnergyTimingProfileRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async createDraft(
    input: ExerciseEnergyTimingProfileDraftInput,
  ): Promise<ExerciseEnergyTimingProfileRecord> {
    assertDraftTimingMetadata(input);
    const policyVersion = input.policyVersion?.trim() || WORKOUT_ENERGY_TIMING_POLICY_VERSION;
    const result = await this.db.query<TimingProfileRow>(
      `INSERT INTO "ExerciseEnergyTimingProfile" (
         "exerciseRevisionId", status, "timingMethod", "secondsPerRep",
         "sourceType", "sourceReference", "sourceVersion", "policyVersion",
         "enabledForCalculation"
       ) VALUES ($1, 'DRAFT', $2, $3, $4, $5, $6, $7, false)
       RETURNING *`,
      [
        input.exerciseRevisionId,
        input.timingMethod,
        input.secondsPerRep,
        input.sourceType,
        input.sourceReference.trim(),
        input.sourceVersion.trim(),
        policyVersion,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('ENERGY_TIMING_PROFILE_CREATE_FAILED');
    return mapRow(row);
  }

  async updateDraft(
    profileId: string,
    patch: Partial<Omit<ExerciseEnergyTimingProfileDraftInput, 'exerciseRevisionId'>>,
  ): Promise<ExerciseEnergyTimingProfileRecord> {
    const existing = await this.findById(profileId);
    if (!existing) throw new Error('ENERGY_TIMING_PROFILE_NOT_FOUND');
    assertCanUpdateTimingDraft(existing);
    const next: ExerciseEnergyTimingProfileDraftInput = {
      exerciseRevisionId: existing.exerciseRevisionId,
      timingMethod: patch.timingMethod ?? existing.timingMethod,
      secondsPerRep: patch.secondsPerRep ?? existing.secondsPerRep,
      sourceType: patch.sourceType ?? existing.sourceType,
      sourceReference: patch.sourceReference ?? existing.sourceReference,
      sourceVersion: patch.sourceVersion ?? existing.sourceVersion,
      policyVersion: patch.policyVersion ?? existing.policyVersion,
    };
    assertDraftTimingMetadata(next);
    const result = await this.db.query<TimingProfileRow>(
      `UPDATE "ExerciseEnergyTimingProfile"
       SET "timingMethod" = $2,
           "secondsPerRep" = $3,
           "sourceType" = $4,
           "sourceReference" = $5,
           "sourceVersion" = $6,
           "policyVersion" = $7,
           "updatedAt" = now()
       WHERE id = $1 AND status = 'DRAFT'
       RETURNING *`,
      [
        profileId,
        next.timingMethod,
        next.secondsPerRep,
        next.sourceType,
        next.sourceReference.trim(),
        next.sourceVersion.trim(),
        next.policyVersion?.trim() || WORKOUT_ENERGY_TIMING_POLICY_VERSION,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('ENERGY_TIMING_PROFILE_IMMUTABLE');
    return mapRow(row);
  }

  async approve(profileId: string, reviewedBy: string): Promise<ExerciseEnergyTimingProfileRecord> {
    const existing = await this.findById(profileId);
    if (!existing) throw new Error('ENERGY_TIMING_PROFILE_NOT_FOUND');
    assertCanApproveTimingProfile(existing, reviewedBy);
    const result = await this.db.query<TimingProfileRow>(
      `UPDATE "ExerciseEnergyTimingProfile"
       SET status = 'APPROVED',
           "enabledForCalculation" = true,
           "reviewedAt" = now(),
           "reviewedBy" = $2,
           "approvedAt" = now(),
           "updatedAt" = now()
       WHERE id = $1 AND status = 'DRAFT'
       RETURNING *`,
      [profileId, reviewedBy.trim()],
    );
    const row = result.rows[0];
    if (!row) throw new Error('ENERGY_TIMING_PROFILE_NOT_DRAFT');
    return mapRow(row);
  }

  async retire(profileId: string, reason?: string): Promise<ExerciseEnergyTimingProfileRecord> {
    const existing = await this.findById(profileId);
    if (!existing) throw new Error('ENERGY_TIMING_PROFILE_NOT_FOUND');
    assertCanRetireTimingProfile(existing);
    const result = await this.db.query<TimingProfileRow>(
      `UPDATE "ExerciseEnergyTimingProfile"
       SET status = 'RETIRED',
           "enabledForCalculation" = false,
           "retiredAt" = now(),
           "retirementReason" = $2,
           "updatedAt" = now()
       WHERE id = $1 AND status = 'APPROVED'
       RETURNING *`,
      [profileId, reason?.trim() || null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('ENERGY_TIMING_PROFILE_NOT_APPROVED');
    return mapRow(row);
  }

  async findById(id: string): Promise<ExerciseEnergyTimingProfileRecord | null> {
    const result = await this.db.query<TimingProfileRow>(
      `SELECT * FROM "ExerciseEnergyTimingProfile" WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByRevision(exerciseRevisionId: string): Promise<ExerciseEnergyTimingProfileRecord[]> {
    const result = await this.db.query<TimingProfileRow>(
      `SELECT * FROM "ExerciseEnergyTimingProfile"
       WHERE "exerciseRevisionId" = $1
       ORDER BY "createdAt" ASC, id ASC`,
      [exerciseRevisionId],
    );
    return result.rows.map(mapRow);
  }

  async resolveApproved(
    exerciseRevisionId: string,
    policyVersion?: string,
  ): Promise<ExerciseEnergyTimingProfileRecord | null> {
    const rows = await this.listByRevision(exerciseRevisionId);
    return selectApprovedTimingProfile(rows, { exerciseRevisionId, policyVersion });
  }
}
