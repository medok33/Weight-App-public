import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { resolveProfileStructureStatus } from '../domain/user-profile.policy';
import type {
  AppLocale,
  GoalUpsertInput,
  ProfileUpsertInput,
  UserGoalRecord,
  UserProfileRecord,
} from '../domain/user-profile.types';
import { parseStringList, serializeStringList } from '../domain/user-profile.types';

type ProfileRow = {
  userId: string;
  displayName: string | null;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: string | null;
  activityLevel: string | null;
  locale: string | null;
  timezone: string | null;
  trainingLevel: string | null;
  workoutsPerWeek: number | null;
  dietaryPreferences: string | null;
  foodRestrictions: string | null;
  availableEquipment: string | null;
  allergenCodesJson?: unknown;
  dietaryCodesJson?: unknown;
  intoleranceCodesJson?: unknown;
  preferredProductIdsJson?: unknown;
  dislikedProductIdsJson?: unknown;
  equipmentCodesJson?: unknown;
  profileStructureStatus?: string | null;
};

type GoalRow = {
  userId: string;
  kind: string;
  target: string;
  unit: string;
  targetDate: string | null;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x)).filter(Boolean);
}

@Injectable()
export class UserProfileRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async createUser(): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      'INSERT INTO "User" (id, email) VALUES (gen_random_uuid(), NULL) RETURNING id',
    );
    const userId = result.rows[0]?.id;
    if (!userId) throw new Error('USER_CREATE_FAILED');
    return userId;
  }

  async userExists(userId: string): Promise<boolean> {
    const result = await this.db.query<{ ok: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM "User" WHERE id = $1) AS ok',
      [userId],
    );
    return result.rows[0]?.ok === true;
  }

  async getProfile(userId: string): Promise<UserProfileRecord | null> {
    const result = await this.db.query<ProfileRow>(
      `SELECT "userId", "displayName", "ageYears", "heightCm", "weightKg", "activityLevel", locale, timezone,
              "trainingLevel", "workoutsPerWeek", "dietaryPreferences", "foodRestrictions", "availableEquipment",
              COALESCE("allergenCodesJson", '[]'::jsonb) AS "allergenCodesJson",
              COALESCE("dietaryCodesJson", '[]'::jsonb) AS "dietaryCodesJson",
              COALESCE("intoleranceCodesJson", '[]'::jsonb) AS "intoleranceCodesJson",
              COALESCE("preferredProductIdsJson", '[]'::jsonb) AS "preferredProductIdsJson",
              COALESCE("dislikedProductIdsJson", '[]'::jsonb) AS "dislikedProductIdsJson",
              COALESCE("equipmentCodesJson", '[]'::jsonb) AS "equipmentCodesJson",
              COALESCE("profileStructureStatus", 'LEGACY_UNSTRUCTURED') AS "profileStructureStatus"
       FROM "UserProfile" WHERE "userId" = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.displayName == null ||
      row.ageYears == null ||
      row.heightCm == null ||
      row.weightKg == null ||
      row.activityLevel == null
    ) {
      return null;
    }
    const allergenCodes = asStringArray(row.allergenCodesJson);
    const dietaryCodes = asStringArray(row.dietaryCodesJson);
    const intoleranceCodes = asStringArray(row.intoleranceCodesJson);
    const equipmentCodes = asStringArray(row.equipmentCodesJson);
    const status = (row.profileStructureStatus ??
      'LEGACY_UNSTRUCTURED') as UserProfileRecord['profileStructureStatus'];
    return {
      userId: row.userId,
      displayName: row.displayName,
      ageYears: row.ageYears,
      heightCm: row.heightCm,
      weightKg: Number(row.weightKg),
      activityLevel: row.activityLevel as UserProfileRecord['activityLevel'],
      locale: (row.locale === 'en' ? 'en' : 'ru') as AppLocale,
      timezone: row.timezone ?? undefined,
      trainingLevel: (row.trainingLevel as UserProfileRecord['trainingLevel']) ?? null,
      workoutsPerWeek: row.workoutsPerWeek ?? null,
      dietaryPreferences: parseStringList(row.dietaryPreferences),
      foodRestrictions: parseStringList(row.foodRestrictions),
      availableEquipment: parseStringList(row.availableEquipment),
      allergenCodes,
      dietaryCodes,
      intoleranceCodes,
      preferredProductIds: asStringArray(row.preferredProductIdsJson),
      dislikedProductIds: asStringArray(row.dislikedProductIdsJson),
      equipmentCodes,
      profileStructureStatus: status,
      legacyNeedsConfirmation:
        status === 'LEGACY_UNSTRUCTURED' || status === 'MIXED' || status === 'NEEDS_CONFIRMATION',
    };
  }

  async upsertProfile(userId: string, input: ProfileUpsertInput): Promise<UserProfileRecord> {
    const structureStatus = resolveProfileStructureStatus(input);
    await this.db.query(
      `INSERT INTO "UserProfile" (
         "userId", "displayName", "ageYears", "heightCm", "weightKg", "activityLevel", locale, timezone,
         "trainingLevel", "workoutsPerWeek", "dietaryPreferences", "foodRestrictions", "availableEquipment",
         "allergenCodesJson", "dietaryCodesJson", "intoleranceCodesJson",
         "preferredProductIdsJson", "dislikedProductIdsJson", "equipmentCodesJson",
         "profileStructureStatus", "updatedAt"
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
         $14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20, now()
       )
       ON CONFLICT ("userId") DO UPDATE SET
         "displayName" = EXCLUDED."displayName",
         "ageYears" = EXCLUDED."ageYears",
         "heightCm" = EXCLUDED."heightCm",
         "weightKg" = EXCLUDED."weightKg",
         "activityLevel" = EXCLUDED."activityLevel",
         locale = EXCLUDED.locale,
         timezone = COALESCE(EXCLUDED.timezone, "UserProfile".timezone),
         "trainingLevel" = EXCLUDED."trainingLevel",
         "workoutsPerWeek" = EXCLUDED."workoutsPerWeek",
         "dietaryPreferences" = EXCLUDED."dietaryPreferences",
         "foodRestrictions" = EXCLUDED."foodRestrictions",
         "availableEquipment" = EXCLUDED."availableEquipment",
         "allergenCodesJson" = EXCLUDED."allergenCodesJson",
         "dietaryCodesJson" = EXCLUDED."dietaryCodesJson",
         "intoleranceCodesJson" = EXCLUDED."intoleranceCodesJson",
         "preferredProductIdsJson" = EXCLUDED."preferredProductIdsJson",
         "dislikedProductIdsJson" = EXCLUDED."dislikedProductIdsJson",
         "equipmentCodesJson" = EXCLUDED."equipmentCodesJson",
         "profileStructureStatus" = EXCLUDED."profileStructureStatus",
         "updatedAt" = now()`,
      [
        userId,
        input.displayName,
        input.ageYears,
        input.heightCm,
        input.weightKg,
        input.activityLevel,
        input.locale ?? 'ru',
        input.timezone ?? null,
        input.trainingLevel ?? null,
        input.workoutsPerWeek ?? null,
        serializeStringList(input.dietaryPreferences),
        serializeStringList(input.foodRestrictions),
        serializeStringList(input.availableEquipment),
        JSON.stringify(input.allergenCodes ?? []),
        JSON.stringify(input.dietaryCodes ?? []),
        JSON.stringify(input.intoleranceCodes ?? []),
        JSON.stringify(input.preferredProductIds ?? []),
        JSON.stringify(input.dislikedProductIds ?? []),
        JSON.stringify(input.equipmentCodes ?? []),
        structureStatus,
      ],
    );
    const profile = await this.getProfile(userId);
    if (!profile) throw new Error('PROFILE_SAVE_FAILED');
    return profile;
  }

  async getGoal(userId: string): Promise<UserGoalRecord | null> {
    const result = await this.db.query<GoalRow>(
      `SELECT p."userId", g.kind, g.target, g.unit, g."targetDate"::text AS "targetDate"
       FROM "UserGoal" g
       JOIN "UserProfile" p ON p.id = g."profileId"
       WHERE p."userId" = $1
       ORDER BY g."createdAt" DESC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      userId: row.userId,
      kind: row.kind,
      target: Number(row.target),
      unit: row.unit,
      targetDate: row.targetDate ? row.targetDate.slice(0, 10) : null,
    };
  }

  async upsertGoal(userId: string, input: GoalUpsertInput): Promise<UserGoalRecord> {
    const profileIdResult = await this.db.query<{ id: string }>(
      'SELECT id FROM "UserProfile" WHERE "userId" = $1',
      [userId],
    );
    const profileId = profileIdResult.rows[0]?.id;
    if (!profileId) throw new Error('GOAL_PROFILE_REQUIRED');

    const existing = await this.db.query<{ id: string }>(
      `SELECT g.id FROM "UserGoal" g WHERE g."profileId" = $1 ORDER BY g."createdAt" DESC LIMIT 1`,
      [profileId],
    );
    const goalId = existing.rows[0]?.id;
    if (goalId) {
      await this.db.query(
        'UPDATE "UserGoal" SET kind = $2, target = $3, unit = $4, "targetDate" = $5 WHERE id = $1',
        [goalId, input.kind, input.target, input.unit, input.targetDate ?? null],
      );
    } else {
      await this.db.query(
        'INSERT INTO "UserGoal" ("profileId", kind, target, unit, "targetDate") VALUES ($1, $2, $3, $4, $5)',
        [profileId, input.kind, input.target, input.unit, input.targetDate ?? null],
      );
    }

    const goal = await this.getGoal(userId);
    if (!goal) throw new Error('GOAL_SAVE_FAILED');
    return goal;
  }
}
