/**
 * CATALOG-V3-01C-B — controlled Batch B ADD loader + Batch A polish/deprecation.
 * Modes: validate | dry-run | apply.
 *
 * Apply (disposable DB only):
 *   NEW: Exercise + DRAFT revision + taxonomy → APPROVE (createdBy 01c-b)
 *   POLISH: successor DRAFT from latest APPROVED → taxonomy → APPROVE (never mutates ever-approved)
 *   DEPRECATE: RETIRE Batch-A APPROVED revision + isActive=false (canonical cleanup)
 *   → does NOT publish / pin
 *   → does NOT set readiness TRUE / Energy / Timing / Media
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { CATALOG_V3_01C_A_CREATED_BY } from './catalog-v3-01c-a-content';
import {
  CATALOG_V3_01C_B_ADVISORY_LOCK_KEY,
  CATALOG_V3_01C_B_CONTENT,
  CATALOG_V3_01C_B_CREATED_BY,
  CATALOG_V3_01C_B_DEPRECATIONS,
  CATALOG_V3_01C_B_EXPECTED_COUNT,
  CATALOG_V3_01C_B_POLISH,
  CATALOG_V3_01C_B_VERSION,
  type V301cBContentEntry,
  type V301cBDeprecationEntry,
  type V301cBPolishEntry,
} from './catalog-v3-01c-b-content';
import {
  assertV301cBContentManifestValid,
  validateV301cBContentManifest,
  type V301cBIssue,
} from './catalog-v3-01c-b-content.validation';
import {
  DISPOSABLE_DB_NAME_PATTERN,
  normalizeHostname,
} from './catalog-v3-01b-classification-loader';
import { inspectDatabaseUrl } from '../../../test-support/assert-disposable-database';

const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type V301cBLoadMode = 'validate' | 'dry-run' | 'apply';
export type V301cBLoadOutcome =
  | 'CREATE'
  | 'POLISH'
  | 'DEPRECATE'
  | 'UNCHANGED'
  | 'CONFLICT'
  | 'INVALID';

export type V301cBLoadItemResult = {
  exerciseKey: string;
  outcome: V301cBLoadOutcome;
  message: string;
  exerciseId?: string;
  revisionId?: string;
  kind: 'NEW' | 'POLISH' | 'DEPRECATE';
};

export type V301cBLoadReport = {
  mode: V301cBLoadMode;
  ok: boolean;
  version: typeof CATALOG_V3_01C_B_VERSION;
  disposableConfirmed: string | null;
  issues: V301cBIssue[];
  items: V301cBLoadItemResult[];
  counts: {
    plannedCreate: number;
    plannedPolish: number;
    plannedDeprecate: number;
    plannedUnchanged: number;
    plannedConflict: number;
    appliedCreate: number;
    appliedPolish: number;
    appliedDeprecate: number;
    appliedUnchanged: number;
  };
  publishedReleaseUnchanged: true;
  newExerciseCount: number;
};

export type V301cBLoaderInput = {
  mode: V301cBLoadMode;
  pool: Pool;
  databaseUrl?: string | null;
  entries?: readonly V301cBContentEntry[];
  polish?: readonly V301cBPolishEntry[];
  deprecations?: readonly V301cBDeprecationEntry[];
};

export function confirmV301cBApplyDatabase(
  databaseUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.WEIGHT_APP_DISPOSABLE_TEST_DB !== '1') {
    throw new Error('UNSAFE_DATABASE_TARGET:DISPOSABLE_MARKER_REQUIRED');
  }
  const inspected = inspectDatabaseUrl(databaseUrl, {
    ...env,
    WEIGHT_APP_DISPOSABLE_TEST_DB: '1',
  });
  if (inspected.ok === false) {
    throw new Error(`UNSAFE_DATABASE_TARGET:${inspected.reason}`);
  }
  const dbName = inspected.database.trim();
  if (dbName.toLowerCase() === 'weight_app') {
    throw new Error('UNSAFE_DATABASE_TARGET:SHARED_WEIGHT_APP_DATABASE_FORBIDDEN');
  }
  if (!DISPOSABLE_DB_NAME_PATTERN.test(dbName)) {
    throw new Error('UNSAFE_DATABASE_TARGET:DISPOSABLE_DB_NAME_REQUIRED');
  }
  const host = normalizeHostname(inspected.host);
  if (!ALLOWED_LOOPBACK_HOSTS.has(host)) {
    throw new Error('UNSAFE_DATABASE_TARGET:HOST_NOT_ALLOWLISTED');
  }
  return dbName;
}

async function countPublishedPins(client: Pool | PoolClient): Promise<number> {
  const res = await client.query<{ c: string }>(
    `SELECT COUNT(i.id)::text AS c
     FROM "WorkoutCatalogRelease" rel
     JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
     WHERE rel.status = 'PUBLISHED'`,
  );
  return Number(res.rows[0]?.c ?? 0);
}

function taxonomyFingerprint(input: {
  primaryMovementPattern: string;
  trainingRole: string;
  progressionGroup: string;
  muscles: readonly { muscleCode: string; involvement: string; sortOrder?: number }[];
  equipmentGroups: readonly {
    groupKind: string;
    sortOrder?: number;
    items: readonly { equipmentCode: string; sortOrder?: number }[];
  }[];
  supportedPlaces: readonly string[];
}): string {
  return JSON.stringify({
    primaryMovementPattern: input.primaryMovementPattern,
    trainingRole: input.trainingRole,
    progressionGroup: input.progressionGroup,
    supportedPlaces: [...input.supportedPlaces].sort(),
    muscles: [...input.muscles]
      .map((m) => ({
        muscleCode: m.muscleCode,
        involvement: m.involvement,
        sortOrder: m.sortOrder ?? 0,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.muscleCode.localeCompare(b.muscleCode)),
    equipmentGroups: input.equipmentGroups.map((g, gi) => ({
      groupKind: g.groupKind,
      sortOrder: g.sortOrder ?? gi,
      items: [...g.items]
        .map((i, ii) => ({
          equipmentCode: i.equipmentCode,
          sortOrder: i.sortOrder ?? ii,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.equipmentCode.localeCompare(b.equipmentCode)),
    })),
  });
}

async function loadRevisionTaxonomyFingerprint(
  client: Pool | PoolClient,
  revisionId: string,
  supportedPlaces: readonly string[],
): Promise<string | null> {
  const tax = await client.query<{
    primaryMovementPattern: string;
    trainingRole: string;
    progressionGroup: string | null;
  }>(
    `SELECT "primaryMovementPattern", "trainingRole", "progressionGroup"
     FROM "ExerciseRevisionTaxonomy" WHERE "exerciseRevisionId" = $1`,
    [revisionId],
  );
  if (!tax.rows[0]) return null;
  const muscles = await client.query<{
    muscleCode: string;
    involvement: string;
    sortOrder: number;
  }>(
    `SELECT "muscleCode", involvement, "sortOrder"
     FROM "ExerciseRevisionMuscleInvolvement"
     WHERE "exerciseRevisionId" = $1
     ORDER BY "sortOrder", "muscleCode"`,
    [revisionId],
  );
  const groups = await client.query<{
    id: string;
    groupKind: string;
    sortOrder: number;
  }>(
    `SELECT id, "groupKind", "sortOrder"
     FROM "ExerciseRevisionEquipmentGroup"
     WHERE "exerciseRevisionId" = $1
     ORDER BY "sortOrder"`,
    [revisionId],
  );
  const equipmentGroups = [];
  for (const g of groups.rows) {
    const items = await client.query<{ equipmentCode: string; sortOrder: number }>(
      `SELECT "equipmentCode", "sortOrder"
       FROM "ExerciseRevisionEquipmentItem"
       WHERE "groupId" = $1
       ORDER BY "sortOrder"`,
      [g.id],
    );
    equipmentGroups.push({
      groupKind: g.groupKind,
      sortOrder: g.sortOrder,
      items: items.rows,
    });
  }
  return taxonomyFingerprint({
    primaryMovementPattern: tax.rows[0].primaryMovementPattern,
    trainingRole: tax.rows[0].trainingRole,
    progressionGroup: tax.rows[0].progressionGroup ?? '',
    muscles: muscles.rows,
    equipmentGroups,
    supportedPlaces,
  });
}

async function findExisting01cBNew(
  client: Pool | PoolClient,
  exerciseKey: string,
): Promise<{
  exerciseId: string;
  revisionId: string;
  nameRu: string;
  techniqueRu: string | null;
  trainingRole: string | null;
} | null> {
  const res = await client.query<{
    exerciseId: string;
    revisionId: string;
    nameRu: string;
    techniqueRu: string | null;
    trainingRole: string | null;
  }>(
    `SELECT e.id AS "exerciseId", r.id AS "revisionId", r."nameRu", r."techniqueRu",
            t."trainingRole"
     FROM "Exercise" e
     JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
     LEFT JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
     WHERE e.key = $1
       AND r.status = 'APPROVED'
       AND r."createdBy" = $2
     ORDER BY r."revisionNumber" DESC
     LIMIT 1`,
    [exerciseKey, CATALOG_V3_01C_B_CREATED_BY],
  );
  return res.rows[0] ?? null;
}

async function findAnyExercise(
  client: Pool | PoolClient,
  exerciseKey: string,
): Promise<{ id: string; isActive: boolean } | null> {
  const res = await client.query<{ id: string; isActive: boolean }>(
    `SELECT id, "isActive" FROM "Exercise" WHERE key = $1 LIMIT 1`,
    [exerciseKey],
  );
  return res.rows[0] ?? null;
}

async function findLatestApprovedRevision(
  client: Pool | PoolClient,
  exerciseId: string,
): Promise<{ id: string; revisionNumber: number; createdBy: string | null } | null> {
  const res = await client.query<{
    id: string;
    revisionNumber: number;
    createdBy: string | null;
  }>(
    `SELECT id, "revisionNumber", "createdBy"
     FROM "ExerciseRevision"
     WHERE "exerciseId" = $1 AND status = 'APPROVED'
     ORDER BY "revisionNumber" DESC
     LIMIT 1`,
    [exerciseId],
  );
  return res.rows[0] ?? null;
}

async function findLatest01cBPolish(
  client: Pool | PoolClient,
  exerciseId: string,
): Promise<{ id: string } | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM "ExerciseRevision"
     WHERE "exerciseId" = $1
       AND status = 'APPROVED'
       AND "createdBy" = $2
     ORDER BY "revisionNumber" DESC
     LIMIT 1`,
    [exerciseId, CATALOG_V3_01C_B_CREATED_BY],
  );
  return res.rows[0] ?? null;
}

export async function planV301cBContent(
  client: Pool | PoolClient,
  entries: readonly V301cBContentEntry[],
  polish: readonly V301cBPolishEntry[],
  deprecations: readonly V301cBDeprecationEntry[],
): Promise<V301cBLoadItemResult[]> {
  const items: V301cBLoadItemResult[] = [];

  for (const entry of entries) {
    const ours = await findExisting01cBNew(client, entry.exerciseKey);
    if (ours) {
      if (
        ours.nameRu !== entry.nameRu ||
        ours.techniqueRu !== entry.techniqueRu ||
        ours.trainingRole !== entry.trainingRole
      ) {
        items.push({
          exerciseKey: entry.exerciseKey,
          outcome: 'CONFLICT',
          message: 'Existing 01C-B revision content differs from SoT',
          exerciseId: ours.exerciseId,
          revisionId: ours.revisionId,
          kind: 'NEW',
        });
        continue;
      }
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'UNCHANGED',
        message: '01C-B exercise already present',
        exerciseId: ours.exerciseId,
        revisionId: ours.revisionId,
        kind: 'NEW',
      });
      continue;
    }
    const any = await findAnyExercise(client, entry.exerciseKey);
    if (any) {
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'CONFLICT',
        message: 'Exercise key exists but is not a 01C-B authored revision',
        exerciseId: any.id,
        kind: 'NEW',
      });
      continue;
    }
    items.push({
      exerciseKey: entry.exerciseKey,
      outcome: 'CREATE',
      message: 'Will create Exercise + APPROVED revision with V3 taxonomy',
      kind: 'NEW',
    });
  }

  for (const entry of polish) {
    const ex = await findAnyExercise(client, entry.exerciseKey);
    if (!ex) {
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'CONFLICT',
        message: 'Polish target exercise missing (Batch A must be applied first)',
        kind: 'POLISH',
      });
      continue;
    }
    const desired = taxonomyFingerprint(entry);
    const existingPolish = await findLatest01cBPolish(client, ex.id);
    if (existingPolish) {
      const fp = await loadRevisionTaxonomyFingerprint(
        client,
        existingPolish.id,
        entry.supportedPlaces,
      );
      if (fp === desired) {
        items.push({
          exerciseKey: entry.exerciseKey,
          outcome: 'UNCHANGED',
          message: '01C-B polish successor already present',
          exerciseId: ex.id,
          revisionId: existingPolish.id,
          kind: 'POLISH',
        });
        continue;
      }
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'CONFLICT',
        message: 'Existing 01C-B polish taxonomy differs from SoT',
        exerciseId: ex.id,
        revisionId: existingPolish.id,
        kind: 'POLISH',
      });
      continue;
    }
    items.push({
      exerciseKey: entry.exerciseKey,
      outcome: 'POLISH',
      message: 'Will create successor APPROVED revision with polished taxonomy',
      exerciseId: ex.id,
      kind: 'POLISH',
    });
  }

  for (const entry of deprecations) {
    const ex = await findAnyExercise(client, entry.exerciseKey);
    if (!ex) {
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'CONFLICT',
        message: 'Deprecation target missing (Batch A must be applied first)',
        kind: 'DEPRECATE',
      });
      continue;
    }
    const retired = await client.query<{ id: string }>(
      `SELECT r.id
       FROM "ExerciseRevision" r
       WHERE r."exerciseId" = $1
         AND r."createdBy" = $2
         AND r.status = 'RETIRED'
       ORDER BY r."revisionNumber" DESC
       LIMIT 1`,
      [ex.id, CATALOG_V3_01C_A_CREATED_BY],
    );
    if (!ex.isActive && retired.rows[0]) {
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'UNCHANGED',
        message: 'Already deprecated (inactive + retired 01C-A revision)',
        exerciseId: ex.id,
        revisionId: retired.rows[0].id,
        kind: 'DEPRECATE',
      });
      continue;
    }
    items.push({
      exerciseKey: entry.exerciseKey,
      outcome: 'DEPRECATE',
      message: `Will retire identity; merge guidance → ${entry.mergeIntoKey}`,
      exerciseId: ex.id,
      kind: 'DEPRECATE',
    });
  }

  return items;
}

async function ensureFamily(
  client: PoolClient,
  entry: V301cBContentEntry,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM "ExerciseFamily" WHERE slug = $1`,
    [entry.familySlug],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO "ExerciseFamily" (id, slug, "nameRu", "nameEn", "movementPattern")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      randomUUID(),
      entry.familySlug,
      entry.familyNameRu,
      entry.familyNameEn,
      entry.generatorMovementPattern,
    ],
  );
  return created.rows[0]!.id;
}

async function writeTaxonomy(
  client: PoolClient,
  revisionId: string,
  entry: {
    primaryMovementPattern: string;
    trainingRole: string;
    progressionGroup: string;
    muscles: readonly { muscleCode: string; involvement: string; sortOrder?: number }[];
    equipmentGroups: readonly {
      groupKind: string;
      sortOrder?: number;
      items: readonly { equipmentCode: string; sortOrder?: number }[];
    }[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO "ExerciseRevisionTaxonomy" (
       "exerciseRevisionId", "primaryMovementPattern", "trainingRole", "progressionGroup"
     ) VALUES ($1, $2, $3, $4)`,
    [
      revisionId,
      entry.primaryMovementPattern,
      entry.trainingRole,
      entry.progressionGroup,
    ],
  );
  for (const m of entry.muscles) {
    await client.query(
      `INSERT INTO "ExerciseRevisionMuscleInvolvement" (
         id, "exerciseRevisionId", "muscleCode", involvement, "sortOrder"
       ) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), revisionId, m.muscleCode, m.involvement, m.sortOrder ?? 0],
    );
  }
  for (const [gi, g] of entry.equipmentGroups.entries()) {
    const groupId = randomUUID();
    await client.query(
      `INSERT INTO "ExerciseRevisionEquipmentGroup" (
         id, "exerciseRevisionId", "groupKind", "sortOrder"
       ) VALUES ($1, $2, $3, $4)`,
      [groupId, revisionId, g.groupKind, g.sortOrder ?? gi],
    );
    for (const [ii, item] of g.items.entries()) {
      await client.query(
        `INSERT INTO "ExerciseRevisionEquipmentItem" (
           id, "groupId", "equipmentCode", "sortOrder"
         ) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), groupId, item.equipmentCode, item.sortOrder ?? ii],
      );
    }
  }
}

function equipmentCodesJson(entry: V301cBContentEntry | V301cBPolishEntry): string {
  const codes = new Set<string>();
  for (const g of entry.equipmentGroups) {
    for (const item of g.items) {
      if (item.equipmentCode !== 'NONE') codes.add(item.equipmentCode);
    }
  }
  if (codes.size === 0) codes.add('NONE');
  return JSON.stringify([...codes]);
}

function muscleGroupsJson(
  entry: V301cBContentEntry | V301cBPolishEntry,
): string {
  return JSON.stringify(entry.muscles.map((m) => m.muscleCode.toLowerCase()));
}

async function createExercise(
  client: PoolClient,
  entry: V301cBContentEntry,
): Promise<{ exerciseId: string; revisionId: string }> {
  const familyId = await ensureFamily(client, entry);
  const exerciseId = randomUUID();
  await client.query(
    `INSERT INTO "Exercise" (
       id, name, "riskLevel", key,
       "nameRu", "nameEn", "displayNameRu", "displayNameEn",
       "techniqueSummaryRu", "commonMistakeRu",
       "movementPattern", difficulty,
       "equipmentCodesJson", "muscleGroupsJson",
       "estimatedMinutes", "isActive", "familyId"
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $5, $6,
       $7, $8,
       $9, $10,
       $11::jsonb, $12::jsonb,
       $13, true, $14
     )`,
    [
      exerciseId,
      entry.exerciseKey,
      entry.riskLevel,
      entry.exerciseKey,
      entry.nameRu,
      entry.nameEn,
      entry.techniqueRu,
      entry.commonMistakeRu,
      entry.generatorMovementPattern,
      entry.difficulty,
      equipmentCodesJson(entry),
      muscleGroupsJson(entry),
      entry.estimatedMinutes,
      familyId,
    ],
  );

  const revision = await client.query<{ id: string }>(
    `INSERT INTO "ExerciseRevision" (
       id, "exerciseId", "revisionNumber", status,
       "nameRu", "nameEn",
       "techniqueRu", "commonMistakeRu",
       "easierVariantRu", "harderVariantRu",
       "breathingRu", "stopConditionsRu",
       "defaultSets", "defaultRepsMin", "defaultRepsMax",
       "defaultDurationSeconds", "defaultRestSeconds",
       "estimatedDurationSeconds", "repetitionMode",
       "createdBy"
     ) VALUES (
       $1, $2, 1, 'DRAFT',
       $3, $4,
       $5, $6,
       $7, $8,
       $9, $10,
       $11, $12, $13,
       $14, $15,
       $16, $17,
       $18
     ) RETURNING id`,
    [
      randomUUID(),
      exerciseId,
      entry.nameRu,
      entry.nameEn,
      entry.techniqueRu,
      entry.commonMistakeRu,
      entry.easierVariantRu,
      entry.harderVariantRu,
      entry.breathingRu,
      entry.stopConditionsRu,
      entry.defaultSets,
      entry.defaultRepsMin,
      entry.defaultRepsMax,
      entry.defaultDurationSeconds,
      entry.defaultRestSeconds,
      entry.estimatedDurationSeconds,
      entry.repetitionMode,
      CATALOG_V3_01C_B_CREATED_BY,
    ],
  );
  const revisionId = revision.rows[0]!.id;

  const overhead = entry.primaryMovementPattern === 'VERTICAL_PUSH';
  const singleLeg =
    entry.exerciseKey.includes('single') ||
    entry.exerciseKey.includes('lateral_lunge') ||
    entry.exerciseKey.includes('step') ||
    entry.exerciseKey.includes('suitcase');
  const deepKnee = ['SQUAT', 'LUNGE'].includes(entry.primaryMovementPattern);
  const floor =
    entry.equipmentGroups.some((g) =>
      g.items.some((i) => i.equipmentCode === 'MAT'),
    ) ||
    entry.exerciseKey.includes('bridge') ||
    entry.exerciseKey.includes('dead_bug') ||
    entry.exerciseKey.includes('hollow');

  await client.query(
    `INSERT INTO "ExerciseSafetyProfile" (
       "exerciseRevisionId",
       "kneeLoad", "shoulderLoad", "spineLoad",
       "impactLevel", "balanceRequirement",
       "floorRequired", "overheadMovement", "deepKneeFlexion", "singleLeg",
       "beginnerAllowed", "requiresSpotter", "internalSafetyNote"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12
     )`,
    [
      revisionId,
      deepKnee ? 'MODERATE' : 'LOW',
      overhead ||
      entry.primaryMovementPattern.includes('PUSH') ||
      entry.primaryMovementPattern.includes('PULL')
        ? 'MODERATE'
        : 'LOW',
      entry.primaryMovementPattern === 'HINGE' ? 'MODERATE' : 'LOW',
      entry.trainingRole === 'CONDITIONING' ? 'MODERATE' : 'LOW',
      singleLeg ? 'MODERATE' : 'LOW',
      floor,
      overhead,
      deepKnee,
      Boolean(singleLeg),
      entry.beginnerAllowed,
      'CATALOG-V3-01C-B canonical safety stub; refine in later packages if needed',
    ],
  );

  await writeTaxonomy(client, revisionId, entry);

  await client.query(
    `UPDATE "ExerciseRevision"
     SET status = 'APPROVED', "reviewedAt" = now(), "approvedAt" = now()
     WHERE id = $1`,
    [revisionId],
  );

  return { exerciseId, revisionId };
}

async function createPolishSuccessor(
  client: PoolClient,
  entry: V301cBPolishEntry,
): Promise<{ exerciseId: string; revisionId: string }> {
  const ex = await findAnyExercise(client, entry.exerciseKey);
  if (!ex) throw new Error(`POLISH_MISSING:${entry.exerciseKey}`);
  const source = await findLatestApprovedRevision(client, ex.id);
  if (!source) throw new Error(`POLISH_NO_SOURCE:${entry.exerciseKey}`);

  const next = await client.query<{ n: number }>(
    `SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS n
     FROM "ExerciseRevision" WHERE "exerciseId" = $1`,
    [ex.id],
  );
  const revisionNumber = Number(next.rows[0]!.n);

  const created = await client.query<{ id: string }>(
    `INSERT INTO "ExerciseRevision" (
       "exerciseId", "revisionNumber", status,
       "nameRu", "nameEn",
       "techniqueRu", "techniqueEn",
       "commonMistakeRu", "commonMistakeEn",
       "easierVariantRu", "easierVariantEn",
       "harderVariantRu", "harderVariantEn",
       "breathingRu", "breathingEn",
       "stopConditionsRu", "stopConditionsEn",
       "defaultSets", "defaultRepsMin", "defaultRepsMax",
       "defaultDurationSeconds", "defaultRestSeconds",
       "estimatedDurationSeconds", "repetitionMode",
       "createdBy"
     )
     SELECT
       "exerciseId", $2, 'DRAFT',
       $4, $5,
       "techniqueRu", "techniqueEn",
       "commonMistakeRu", "commonMistakeEn",
       "easierVariantRu", "easierVariantEn",
       "harderVariantRu", "harderVariantEn",
       "breathingRu", "breathingEn",
       "stopConditionsRu", "stopConditionsEn",
       "defaultSets", "defaultRepsMin", "defaultRepsMax",
       "defaultDurationSeconds", "defaultRestSeconds",
       "estimatedDurationSeconds", "repetitionMode",
       $3
     FROM "ExerciseRevision"
     WHERE id = $1
     RETURNING id`,
    [
      source.id,
      revisionNumber,
      CATALOG_V3_01C_B_CREATED_BY,
      entry.nameRu,
      entry.nameEn,
    ],
  );
  const revisionId = created.rows[0]!.id;

  await writeTaxonomy(client, revisionId, entry);

  await client.query(
    `UPDATE "Exercise"
     SET "equipmentCodesJson" = $2::jsonb,
         "muscleGroupsJson" = $3::jsonb
     WHERE id = $1`,
    [ex.id, equipmentCodesJson(entry), muscleGroupsJson(entry)],
  );

  await client.query(
    `UPDATE "ExerciseRevision"
     SET status = 'APPROVED', "reviewedAt" = now(), "approvedAt" = now()
     WHERE id = $1`,
    [revisionId],
  );

  return { exerciseId: ex.id, revisionId };
}

async function deprecateExercise(
  client: PoolClient,
  entry: V301cBDeprecationEntry,
): Promise<{ exerciseId: string; revisionId: string }> {
  const ex = await findAnyExercise(client, entry.exerciseKey);
  if (!ex) throw new Error(`DEPRECATE_MISSING:${entry.exerciseKey}`);

  const source = await client.query<{ id: string }>(
    `SELECT id FROM "ExerciseRevision"
     WHERE "exerciseId" = $1
       AND "createdBy" = $2
       AND status = 'APPROVED'
     ORDER BY "revisionNumber" DESC
     LIMIT 1`,
    [ex.id, CATALOG_V3_01C_A_CREATED_BY],
  );
  if (!source.rows[0]) {
    throw new Error(`DEPRECATE_NO_APPROVED_01C_A:${entry.exerciseKey}`);
  }

  await client.query(
    `UPDATE "ExerciseRevision"
     SET status = 'RETIRED'
     WHERE id = $1`,
    [source.rows[0].id],
  );
  await client.query(`UPDATE "Exercise" SET "isActive" = false WHERE id = $1`, [
    ex.id,
  ]);

  return { exerciseId: ex.id, revisionId: source.rows[0].id };
}

function summarize(items: V301cBLoadItemResult[]) {
  return {
    plannedCreate: items.filter((i) => i.outcome === 'CREATE').length,
    plannedPolish: items.filter((i) => i.outcome === 'POLISH').length,
    plannedDeprecate: items.filter((i) => i.outcome === 'DEPRECATE').length,
    plannedUnchanged: items.filter((i) => i.outcome === 'UNCHANGED').length,
    plannedConflict: items.filter((i) => i.outcome === 'CONFLICT').length,
  };
}

export async function runCatalogV301cBContentLoad(
  input: V301cBLoaderInput,
): Promise<V301cBLoadReport> {
  const entries = input.entries ?? CATALOG_V3_01C_B_CONTENT;
  const polish = input.polish ?? CATALOG_V3_01C_B_POLISH;
  const deprecations = input.deprecations ?? CATALOG_V3_01C_B_DEPRECATIONS;
  const manifest = validateV301cBContentManifest(entries);
  const base: V301cBLoadReport = {
    mode: input.mode,
    ok: false,
    version: CATALOG_V3_01C_B_VERSION,
    disposableConfirmed: null,
    issues: [...manifest.issues],
    items: [],
    counts: {
      plannedCreate: 0,
      plannedPolish: 0,
      plannedDeprecate: 0,
      plannedUnchanged: 0,
      plannedConflict: 0,
      appliedCreate: 0,
      appliedPolish: 0,
      appliedDeprecate: 0,
      appliedUnchanged: 0,
    },
    publishedReleaseUnchanged: true,
    newExerciseCount: 0,
  };

  if (input.mode === 'validate') {
    return {
      ...base,
      ok: manifest.ok,
      newExerciseCount: entries.length,
    };
  }

  if (!manifest.ok) {
    return base;
  }
  assertV301cBContentManifestValid(entries);

  const pinsBefore = await countPublishedPins(input.pool);
  const planned = await planV301cBContent(input.pool, entries, polish, deprecations);
  const planCounts = summarize(planned);
  base.items = planned;
  base.counts = { ...base.counts, ...planCounts };

  if (planCounts.plannedConflict > 0) {
    return {
      ...base,
      ok: false,
      issues: [
        ...base.issues,
        ...planned
          .filter((i) => i.outcome === 'CONFLICT')
          .map((i) => ({
            code: 'CONTENT_CONFLICT',
            message: i.message,
            exerciseKey: i.exerciseKey,
          })),
      ],
    };
  }

  if (input.mode === 'dry-run') {
    return {
      ...base,
      ok: true,
      newExerciseCount: CATALOG_V3_01C_B_EXPECTED_COUNT,
    };
  }

  const disposable = confirmV301cBApplyDatabase(input.databaseUrl);
  const client = await input.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [
      CATALOG_V3_01C_B_ADVISORY_LOCK_KEY,
    ]);

    const lockedPlan = await planV301cBContent(client, entries, polish, deprecations);
    let appliedCreate = 0;
    let appliedPolish = 0;
    let appliedDeprecate = 0;
    let appliedUnchanged = 0;
    const items: V301cBLoadItemResult[] = [];

    for (const entry of entries) {
      const planItem = lockedPlan.find(
        (p) => p.exerciseKey === entry.exerciseKey && p.kind === 'NEW',
      )!;
      if (planItem.outcome === 'UNCHANGED') {
        appliedUnchanged += 1;
        items.push(planItem);
        continue;
      }
      if (planItem.outcome === 'CONFLICT') {
        throw new Error(`CONTENT_CONFLICT:${entry.exerciseKey}`);
      }
      const created = await createExercise(client, entry);
      appliedCreate += 1;
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'CREATE',
        message: 'Created Exercise + APPROVED V3 revision',
        exerciseId: created.exerciseId,
        revisionId: created.revisionId,
        kind: 'NEW',
      });
    }

    for (const entry of polish) {
      const planItem = lockedPlan.find(
        (p) => p.exerciseKey === entry.exerciseKey && p.kind === 'POLISH',
      )!;
      if (planItem.outcome === 'UNCHANGED') {
        appliedUnchanged += 1;
        items.push(planItem);
        continue;
      }
      if (planItem.outcome === 'CONFLICT') {
        throw new Error(`POLISH_CONFLICT:${entry.exerciseKey}`);
      }
      const created = await createPolishSuccessor(client, entry);
      appliedPolish += 1;
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'POLISH',
        message: `Created polish successor (immutable prior revision preserved): ${entry.polishReason}`,
        exerciseId: created.exerciseId,
        revisionId: created.revisionId,
        kind: 'POLISH',
      });
    }

    for (const entry of deprecations) {
      const planItem = lockedPlan.find(
        (p) => p.exerciseKey === entry.exerciseKey && p.kind === 'DEPRECATE',
      )!;
      if (planItem.outcome === 'UNCHANGED') {
        appliedUnchanged += 1;
        items.push(planItem);
        continue;
      }
      if (planItem.outcome === 'CONFLICT') {
        throw new Error(`DEPRECATE_CONFLICT:${entry.exerciseKey}`);
      }
      const deprecated = await deprecateExercise(client, entry);
      appliedDeprecate += 1;
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'DEPRECATE',
        message: entry.reason,
        exerciseId: deprecated.exerciseId,
        revisionId: deprecated.revisionId,
        kind: 'DEPRECATE',
      });
    }

    const pinsAfter = await countPublishedPins(client);
    if (pinsAfter !== pinsBefore) {
      throw new Error('PUBLISHED_PINS_MUTATED');
    }

    const readiness = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "ExerciseRevisionReadiness" rd
       JOIN "ExerciseRevision" r ON r.id = rd."exerciseRevisionId"
       WHERE r."createdBy" = $1
         AND (
           rd."generatorReady" IS TRUE
           OR rd."energyReady" IS TRUE
           OR rd."timingReady" IS TRUE
           OR rd."mediaReady" IS TRUE
           OR rd."catalogReady" IS TRUE
         )`,
      [CATALOG_V3_01C_B_CREATED_BY],
    );
    if (Number(readiness.rows[0]?.c ?? 0) > 0) {
      throw new Error('FAKE_READINESS_PRESENT');
    }

    const createdCount = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "Exercise" e
       JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
       JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
       WHERE r."createdBy" = $1
         AND r.status = 'APPROVED'
         AND e."isActive" = true
         AND r."revisionNumber" = 1`,
      [CATALOG_V3_01C_B_CREATED_BY],
    );
    if (Number(createdCount.rows[0]?.c ?? 0) !== CATALOG_V3_01C_B_EXPECTED_COUNT) {
      throw new Error(
        `CREATE_COUNT_MISMATCH:${createdCount.rows[0]?.c}:${CATALOG_V3_01C_B_EXPECTED_COUNT}`,
      );
    }

    await client.query('COMMIT');
    return {
      ...base,
      disposableConfirmed: disposable,
      ok: true,
      items,
      counts: {
        ...base.counts,
        appliedCreate,
        appliedPolish,
        appliedDeprecate,
        appliedUnchanged,
      },
      newExerciseCount: CATALOG_V3_01C_B_EXPECTED_COUNT,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      disposableConfirmed: disposable,
      ok: false,
      issues: [...base.issues, { code: 'APPLY_FAILED', message }],
    };
  } finally {
    client.release();
  }
}
