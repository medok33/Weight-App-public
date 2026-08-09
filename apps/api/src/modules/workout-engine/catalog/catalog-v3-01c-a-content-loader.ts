/**
 * CATALOG-V3-01C-A — controlled NEW exercise content loader.
 * Modes: validate | dry-run | apply.
 *
 * Apply (disposable DB only):
 *   ensure ExerciseFamily
 *   → INSERT Exercise (new key)
 *   → INSERT DRAFT ExerciseRevision + safety + V3 taxonomy
 *   → APPROVE revision
 *   → does NOT publish / pin into PUBLISHED release
 *   → does NOT set readiness TRUE / Energy / Timing / Media
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CATALOG_V3_01C_A_ADVISORY_LOCK_KEY,
  CATALOG_V3_01C_A_CONTENT,
  CATALOG_V3_01C_A_CREATED_BY,
  CATALOG_V3_01C_A_EXPECTED_COUNT,
  CATALOG_V3_01C_A_VERSION,
  type V301cAContentEntry,
} from './catalog-v3-01c-a-content';
import {
  assertV301cAContentManifestValid,
  validateV301cAContentManifest,
  type V301cAIssue,
} from './catalog-v3-01c-a-content.validation';
import {
  DISPOSABLE_DB_NAME_PATTERN,
  normalizeHostname,
} from './catalog-v3-01b-classification-loader';
import { inspectDatabaseUrl } from '../../../test-support/assert-disposable-database';

const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type V301cALoadMode = 'validate' | 'dry-run' | 'apply';
export type V301cALoadOutcome =
  | 'CREATE'
  | 'UNCHANGED'
  | 'CONFLICT'
  | 'INVALID';

export type V301cALoadItemResult = {
  exerciseKey: string;
  outcome: V301cALoadOutcome;
  message: string;
  exerciseId?: string;
  revisionId?: string;
};

export type V301cALoadReport = {
  mode: V301cALoadMode;
  ok: boolean;
  version: typeof CATALOG_V3_01C_A_VERSION;
  disposableConfirmed: string | null;
  issues: V301cAIssue[];
  items: V301cALoadItemResult[];
  counts: {
    plannedCreate: number;
    plannedUnchanged: number;
    plannedConflict: number;
    appliedCreate: number;
    appliedUnchanged: number;
  };
  /** Published release pin set must remain untouched. */
  publishedReleaseUnchanged: true;
  newExerciseCount: number;
};

export type V301cALoaderInput = {
  mode: V301cALoadMode;
  pool: Pool;
  databaseUrl?: string | null;
  entries?: readonly V301cAContentEntry[];
};

export function confirmV301cAApplyDatabase(
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

async function findExisting01cA(
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
    [exerciseKey, CATALOG_V3_01C_A_CREATED_BY],
  );
  return res.rows[0] ?? null;
}

async function findAnyExercise(
  client: Pool | PoolClient,
  exerciseKey: string,
): Promise<{ id: string } | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM "Exercise" WHERE key = $1 LIMIT 1`,
    [exerciseKey],
  );
  return res.rows[0] ?? null;
}

export async function planV301cAContent(
  client: Pool | PoolClient,
  entries: readonly V301cAContentEntry[],
): Promise<V301cALoadItemResult[]> {
  const items: V301cALoadItemResult[] = [];
  for (const entry of entries) {
    const ours = await findExisting01cA(client, entry.exerciseKey);
    if (ours) {
      if (
        ours.nameRu !== entry.nameRu ||
        ours.techniqueRu !== entry.techniqueRu ||
        ours.trainingRole !== entry.trainingRole
      ) {
        items.push({
          exerciseKey: entry.exerciseKey,
          outcome: 'CONFLICT',
          message: 'Existing 01C-A revision content differs from SoT',
          exerciseId: ours.exerciseId,
          revisionId: ours.revisionId,
        });
        continue;
      }
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'UNCHANGED',
        message: '01C-A exercise already present',
        exerciseId: ours.exerciseId,
        revisionId: ours.revisionId,
      });
      continue;
    }
    const any = await findAnyExercise(client, entry.exerciseKey);
    if (any) {
      items.push({
        exerciseKey: entry.exerciseKey,
        outcome: 'CONFLICT',
        message: 'Exercise key exists but is not a 01C-A authored revision',
        exerciseId: any.id,
      });
      continue;
    }
    items.push({
      exerciseKey: entry.exerciseKey,
      outcome: 'CREATE',
      message: 'Will create Exercise + APPROVED revision with V3 taxonomy',
    });
  }
  return items;
}

async function ensureFamily(
  client: PoolClient,
  entry: V301cAContentEntry,
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
  entry: V301cAContentEntry,
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

function equipmentCodesJson(entry: V301cAContentEntry): string {
  const codes = new Set<string>();
  for (const g of entry.equipmentGroups) {
    for (const item of g.items) {
      if (item.equipmentCode !== 'NONE') codes.add(item.equipmentCode);
    }
  }
  if (codes.size === 0) codes.add('NONE');
  return JSON.stringify([...codes]);
}

function muscleGroupsJson(entry: V301cAContentEntry): string {
  return JSON.stringify(entry.muscles.map((m) => m.muscleCode.toLowerCase()));
}

async function createExercise(
  client: PoolClient,
  entry: V301cAContentEntry,
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
      CATALOG_V3_01C_A_CREATED_BY,
    ],
  );
  const revisionId = revision.rows[0]!.id;

  const overhead = entry.primaryMovementPattern === 'VERTICAL_PUSH';
  const singleLeg =
    entry.exerciseKey.includes('single') ||
    entry.exerciseKey.includes('bulgarian') ||
    entry.exerciseKey.includes('step_up') ||
    entry.exerciseKey.includes('walking_lunge');
  const deepKnee = ['SQUAT', 'LUNGE'].includes(entry.primaryMovementPattern);
  const floor = entry.equipmentGroups.some((g) =>
    g.items.some((i) => i.equipmentCode === 'MAT'),
  ) || entry.exerciseKey.includes('bridge') || entry.exerciseKey.includes('fly');

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
      overhead || entry.primaryMovementPattern.includes('PUSH') || entry.primaryMovementPattern.includes('PULL')
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
      'CATALOG-V3-01C-A canonical safety stub; refine in later packages if needed',
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

export async function runCatalogV301cAContentLoad(
  input: V301cALoaderInput,
): Promise<V301cALoadReport> {
  const entries = input.entries ?? CATALOG_V3_01C_A_CONTENT;
  const manifest = validateV301cAContentManifest(entries);
  const base: V301cALoadReport = {
    mode: input.mode,
    ok: false,
    version: CATALOG_V3_01C_A_VERSION,
    disposableConfirmed: null,
    issues: [...manifest.issues],
    items: [],
    counts: {
      plannedCreate: 0,
      plannedUnchanged: 0,
      plannedConflict: 0,
      appliedCreate: 0,
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
  assertV301cAContentManifestValid(entries);

  const pinsBefore = await countPublishedPins(input.pool);
  const planned = await planV301cAContent(input.pool, entries);
  base.items = planned;
  base.counts.plannedCreate = planned.filter((i) => i.outcome === 'CREATE').length;
  base.counts.plannedUnchanged = planned.filter((i) => i.outcome === 'UNCHANGED').length;
  base.counts.plannedConflict = planned.filter((i) => i.outcome === 'CONFLICT').length;

  if (base.counts.plannedConflict > 0) {
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
      newExerciseCount: CATALOG_V3_01C_A_EXPECTED_COUNT,
    };
  }

  // apply
  const disposable = confirmV301cAApplyDatabase(input.databaseUrl);
  const client = await input.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [
      CATALOG_V3_01C_A_ADVISORY_LOCK_KEY,
    ]);

    const lockedPlan = await planV301cAContent(client, entries);
    let appliedCreate = 0;
    let appliedUnchanged = 0;
    const items: V301cALoadItemResult[] = [];

    for (const entry of entries) {
      const planItem = lockedPlan.find((p) => p.exerciseKey === entry.exerciseKey)!;
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
      });
    }

    const pinsAfter = await countPublishedPins(client);
    if (pinsAfter !== pinsBefore) {
      throw new Error('PUBLISHED_PINS_MUTATED');
    }

    // No fabricated readiness TRUE on new revisions.
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
      [CATALOG_V3_01C_A_CREATED_BY],
    );
    if (Number(readiness.rows[0]?.c ?? 0) > 0) {
      throw new Error('FAKE_READINESS_PRESENT');
    }

    const createdCount = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "Exercise" e
       JOIN "ExerciseRevision" r ON r."exerciseId" = e.id
       JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
       WHERE r."createdBy" = $1 AND r.status = 'APPROVED'`,
      [CATALOG_V3_01C_A_CREATED_BY],
    );
    if (Number(createdCount.rows[0]?.c ?? 0) !== CATALOG_V3_01C_A_EXPECTED_COUNT) {
      throw new Error(
        `CREATE_COUNT_MISMATCH:${createdCount.rows[0]?.c}:${CATALOG_V3_01C_A_EXPECTED_COUNT}`,
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
        appliedUnchanged,
      },
      newExerciseCount: CATALOG_V3_01C_A_EXPECTED_COUNT,
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
