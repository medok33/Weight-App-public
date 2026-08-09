import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  WORKOUT_ENERGY_POLICY_VERSION,
  type ExerciseEnergyProfileDraftInput,
  type ExerciseEnergyProfileRecord,
  type ExerciseEnergyProfileStatus,
} from './workout-energy.types';
import {
  assertCanApprove,
  assertCanRetire,
  assertCanUpdateDraft,
  assertDraftEnergyMetadata,
  selectApprovedEnergyProfile,
} from './exercise-energy-profile.lifecycle';

type ProfileRow = {
  id: string;
  exerciseRevisionId: string;
  status: ExerciseEnergyProfileStatus;
  calculationMethod: string;
  populationType: string;
  compendiumEdition: string;
  compendiumCode: string;
  metValue: string | number;
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

function mapRow(row: ProfileRow): ExerciseEnergyProfileRecord {
  return {
    id: row.id,
    exerciseRevisionId: row.exerciseRevisionId,
    status: row.status,
    calculationMethod: row.calculationMethod as ExerciseEnergyProfileRecord['calculationMethod'],
    populationType: row.populationType as ExerciseEnergyProfileRecord['populationType'],
    compendiumEdition: row.compendiumEdition as ExerciseEnergyProfileRecord['compendiumEdition'],
    compendiumCode: row.compendiumCode,
    metValue: Number(row.metValue),
    sourceType: row.sourceType as ExerciseEnergyProfileRecord['sourceType'],
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
export class ExerciseEnergyProfileRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async createDraft(input: ExerciseEnergyProfileDraftInput): Promise<ExerciseEnergyProfileRecord> {
    assertDraftEnergyMetadata(input);
    const policyVersion = input.policyVersion?.trim() || WORKOUT_ENERGY_POLICY_VERSION;
    const result = await this.db.query<ProfileRow>(
      `INSERT INTO "ExerciseEnergyProfile" (
         "exerciseRevisionId", status, "calculationMethod", "populationType",
         "compendiumEdition", "compendiumCode", "metValue", "sourceType",
         "sourceReference", "sourceVersion", "policyVersion", "enabledForCalculation"
       ) VALUES (
         $1, 'DRAFT', $2, $3, $4, $5, $6, $7, $8, $9, $10, false
       ) RETURNING *`,
      [
        input.exerciseRevisionId,
        input.calculationMethod,
        input.populationType,
        input.compendiumEdition,
        input.compendiumCode.trim(),
        input.metValue,
        input.sourceType,
        input.sourceReference.trim(),
        input.sourceVersion.trim(),
        policyVersion,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('ENERGY_PROFILE_CREATE_FAILED');
    return mapRow(row);
  }

  async updateDraft(
    profileId: string,
    patch: Partial<Omit<ExerciseEnergyProfileDraftInput, 'exerciseRevisionId'>>,
  ): Promise<ExerciseEnergyProfileRecord> {
    const existing = await this.findById(profileId);
    if (!existing) throw new Error('ENERGY_PROFILE_NOT_FOUND');
    assertCanUpdateDraft(existing);
    const next: ExerciseEnergyProfileDraftInput = {
      exerciseRevisionId: existing.exerciseRevisionId,
      calculationMethod: patch.calculationMethod ?? existing.calculationMethod,
      populationType: patch.populationType ?? existing.populationType,
      compendiumEdition: patch.compendiumEdition ?? existing.compendiumEdition,
      compendiumCode: patch.compendiumCode ?? existing.compendiumCode,
      metValue: patch.metValue ?? existing.metValue,
      sourceType: patch.sourceType ?? existing.sourceType,
      sourceReference: patch.sourceReference ?? existing.sourceReference,
      sourceVersion: patch.sourceVersion ?? existing.sourceVersion,
      policyVersion: patch.policyVersion ?? existing.policyVersion,
    };
    assertDraftEnergyMetadata(next);
    const result = await this.db.query<ProfileRow>(
      `UPDATE "ExerciseEnergyProfile"
       SET "calculationMethod" = $2,
           "populationType" = $3,
           "compendiumEdition" = $4,
           "compendiumCode" = $5,
           "metValue" = $6,
           "sourceType" = $7,
           "sourceReference" = $8,
           "sourceVersion" = $9,
           "policyVersion" = $10,
           "updatedAt" = now()
       WHERE id = $1 AND status = 'DRAFT'
       RETURNING *`,
      [
        profileId,
        next.calculationMethod,
        next.populationType,
        next.compendiumEdition,
        next.compendiumCode.trim(),
        next.metValue,
        next.sourceType,
        next.sourceReference.trim(),
        next.sourceVersion.trim(),
        next.policyVersion?.trim() || WORKOUT_ENERGY_POLICY_VERSION,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('ENERGY_PROFILE_IMMUTABLE');
    return mapRow(row);
  }

  async approve(profileId: string, reviewedBy: string): Promise<ExerciseEnergyProfileRecord> {
    const existing = await this.findById(profileId);
    if (!existing) throw new Error('ENERGY_PROFILE_NOT_FOUND');
    assertCanApprove(existing, reviewedBy);
    const result = await this.db.query<ProfileRow>(
      `UPDATE "ExerciseEnergyProfile"
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
    if (!row) throw new Error('ENERGY_PROFILE_NOT_DRAFT');
    return mapRow(row);
  }

  async retire(profileId: string, reason?: string): Promise<ExerciseEnergyProfileRecord> {
    const existing = await this.findById(profileId);
    if (!existing) throw new Error('ENERGY_PROFILE_NOT_FOUND');
    assertCanRetire(existing);
    const result = await this.db.query<ProfileRow>(
      `UPDATE "ExerciseEnergyProfile"
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
    if (!row) throw new Error('ENERGY_PROFILE_NOT_APPROVED');
    return mapRow(row);
  }

  async findById(id: string): Promise<ExerciseEnergyProfileRecord | null> {
    const result = await this.db.query<ProfileRow>(
      `SELECT * FROM "ExerciseEnergyProfile" WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByRevision(exerciseRevisionId: string): Promise<ExerciseEnergyProfileRecord[]> {
    const result = await this.db.query<ProfileRow>(
      `SELECT * FROM "ExerciseEnergyProfile"
       WHERE "exerciseRevisionId" = $1
       ORDER BY "createdAt" ASC, id ASC`,
      [exerciseRevisionId],
    );
    return result.rows.map(mapRow);
  }

  async resolveApproved(
    exerciseRevisionId: string,
    policyVersion?: string,
  ): Promise<ExerciseEnergyProfileRecord | null> {
    const rows = await this.listByRevision(exerciseRevisionId);
    return selectApprovedEnergyProfile(rows, { exerciseRevisionId, policyVersion });
  }
}
