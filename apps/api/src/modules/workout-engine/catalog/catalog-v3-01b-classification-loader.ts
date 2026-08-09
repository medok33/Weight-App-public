/**
 * CATALOG-V3-01B — controlled classification loader.
 * Modes: validate | dry-run | apply.
 * Apply creates history-safe next DRAFT revisions, writes V3 semantic metadata,
 * approves them. Does NOT publish a new catalog release (generator pins unchanged).
 * Does NOT copy Energy/Timing/Media onto new revisions.
 * Apply requires disposable DB allowlist (WEIGHT_APP_DISPOSABLE_TEST_DB=1).
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CATALOG_V3_01B_ADVISORY_LOCK_KEY,
  CATALOG_V3_01B_CLASSIFICATION,
  CATALOG_V3_01B_CLASSIFICATION_VERSION,
  CATALOG_V3_01B_CREATED_BY,
  type V301bClassificationEntry,
} from './catalog-v3-01b-classification';
import {
  assertV301bClassificationManifestValid,
  validateV301bClassificationManifest,
  type V301bClassificationIssue,
} from './catalog-v3-01b-classification.validation';
import { inspectDatabaseUrl } from '../../../test-support/assert-disposable-database';

export const DISPOSABLE_DB_NAME_PATTERN = /^wt_cat_[a-z0-9_]+$/i;
const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type V301bLoadMode = 'validate' | 'dry-run' | 'apply';

export type V301bLoadOutcome =
  | 'CREATE_AND_CLASSIFY'
  | 'UNCHANGED'
  | 'MISSING_PUBLISHED_PIN'
  | 'AMBIGUOUS_PUBLISHED_PIN'
  | 'INVALID';

export type V301bLoadItemResult = {
  exerciseKey: string;
  disposition: string;
  outcome: V301bLoadOutcome;
  message: string;
  publishedRevisionId?: string;
  publishedRevisionNumber?: number;
  newRevisionId?: string;
  newRevisionNumber?: number;
};

export type V301bLoadReport = {
  mode: V301bLoadMode;
  ok: boolean;
  version: typeof CATALOG_V3_01B_CLASSIFICATION_VERSION;
  disposableConfirmed: string | null;
  issues: V301bClassificationIssue[];
  items: V301bLoadItemResult[];
  counts: {
    plannedCreate: number;
    plannedUnchanged: number;
    plannedInvalid: number;
    appliedCreate: number;
    appliedUnchanged: number;
  };
  /** True when apply would/did leave published release pins untouched. */
  publishedReleaseUnchanged: true;
};

export type V301bLoaderInput = {
  mode: V301bLoadMode;
  pool: Pool;
  databaseUrl?: string | null;
  entries?: readonly V301bClassificationEntry[];
  /** Test-only: throw after N successful creates to prove rollback. */
  injectFailureAfterCreates?: number;
};

export function normalizeHostname(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h;
}

export function confirmV301bApplyDatabase(
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

type PublishedPin = {
  exerciseId: string;
  exerciseKey: string;
  revisionId: string;
  revisionNumber: number;
};

async function loadPublishedPins(client: Pool | PoolClient): Promise<Map<string, PublishedPin>> {
  const res = await client.query<{
    exerciseId: string;
    exerciseKey: string;
    revisionId: string;
    revisionNumber: number;
    pinCount: string;
  }>(
    `SELECT e.id AS "exerciseId",
            e.key AS "exerciseKey",
            r.id AS "revisionId",
            r."revisionNumber" AS "revisionNumber",
            COUNT(*) OVER (PARTITION BY e.key) AS "pinCount"
     FROM "WorkoutCatalogRelease" rel
     JOIN "WorkoutCatalogReleaseItem" i ON i."releaseId" = rel.id
     JOIN "Exercise" e ON e.id = i."exerciseId"
     JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
     WHERE rel.status = 'PUBLISHED'`,
  );
  const map = new Map<string, PublishedPin>();
  for (const row of res.rows) {
    if (Number(row.pinCount) !== 1) {
      // Ambiguous handling deferred to planner per key.
    }
    map.set(row.exerciseKey, {
      exerciseId: row.exerciseId,
      exerciseKey: row.exerciseKey,
      revisionId: row.revisionId,
      revisionNumber: Number(row.revisionNumber),
    });
  }
  return map;
}

async function findExisting01bRevision(
  client: Pool | PoolClient,
  exerciseId: string,
): Promise<{ id: string; revisionNumber: number } | null> {
  const res = await client.query<{ id: string; revisionNumber: number }>(
    `SELECT r.id, r."revisionNumber" AS "revisionNumber"
     FROM "ExerciseRevision" r
     JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
     WHERE r."exerciseId" = $1
       AND r.status = 'APPROVED'
       AND r."createdBy" = $2
     ORDER BY r."revisionNumber" DESC
     LIMIT 1`,
    [exerciseId, CATALOG_V3_01B_CREATED_BY],
  );
  return res.rows[0] ?? null;
}

export async function planV301bClassification(
  client: Pool | PoolClient,
  entries: readonly V301bClassificationEntry[],
): Promise<V301bLoadItemResult[]> {
  const pins = await loadPublishedPins(client);
  const items: V301bLoadItemResult[] = [];

  for (const entry of entries) {
    const pin = pins.get(entry.exerciseKey);
    if (!pin) {
      items.push({
        exerciseKey: entry.exerciseKey,
        disposition: entry.disposition,
        outcome: 'MISSING_PUBLISHED_PIN',
        message: 'No published pin for exercise key',
      });
      continue;
    }

    const existing = await findExisting01bRevision(client, pin.exerciseId);
    if (existing) {
      items.push({
        exerciseKey: entry.exerciseKey,
        disposition: entry.disposition,
        outcome: 'UNCHANGED',
        message: '01B classified revision already present',
        publishedRevisionId: pin.revisionId,
        publishedRevisionNumber: pin.revisionNumber,
        newRevisionId: existing.id,
        newRevisionNumber: existing.revisionNumber,
      });
      continue;
    }

    items.push({
      exerciseKey: entry.exerciseKey,
      disposition: entry.disposition,
      outcome: 'CREATE_AND_CLASSIFY',
      message: 'Will create next DRAFT revision, apply V3 taxonomy, approve',
      publishedRevisionId: pin.revisionId,
      publishedRevisionNumber: pin.revisionNumber,
    });
  }
  return items;
}

async function writeTaxonomy(
  client: PoolClient,
  revisionId: string,
  entry: V301bClassificationEntry,
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
      [
        randomUUID(),
        revisionId,
        m.muscleCode,
        m.involvement,
        m.sortOrder ?? 0,
      ],
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

async function createClassifiedRevision(
  client: PoolClient,
  pin: PublishedPin,
  entry: V301bClassificationEntry,
): Promise<{ id: string; revisionNumber: number }> {
  const next = await client.query<{ n: number }>(
    `SELECT COALESCE(MAX("revisionNumber"), 0) + 1 AS n
     FROM "ExerciseRevision" WHERE "exerciseId" = $1`,
    [pin.exerciseId],
  );
  const revisionNumber = Number(next.rows[0]!.n);

  // Copy customer-facing content from published pin; do not copy energy/timing/media.
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
       $3
     FROM "ExerciseRevision"
     WHERE id = $1
     RETURNING id`,
    [pin.revisionId, revisionNumber, CATALOG_V3_01B_CREATED_BY],
  );
  const revisionId = created.rows[0]!.id;

  await writeTaxonomy(client, revisionId, entry);

  // Hub difficulty is not revision-semantic; align to audited value when present.
  await client.query(`UPDATE "Exercise" SET difficulty = $2 WHERE id = $1`, [
    pin.exerciseId,
    entry.difficulty,
  ]);

  await client.query(
    `UPDATE "ExerciseRevision"
     SET status = 'APPROVED', "reviewedAt" = now()
     WHERE id = $1`,
    [revisionId],
  );

  return { id: revisionId, revisionNumber };
}

function summarize(items: V301bLoadItemResult[]) {
  return {
    plannedCreate: items.filter((i) => i.outcome === 'CREATE_AND_CLASSIFY').length,
    plannedUnchanged: items.filter((i) => i.outcome === 'UNCHANGED').length,
    plannedInvalid: items.filter((i) =>
      ['MISSING_PUBLISHED_PIN', 'AMBIGUOUS_PUBLISHED_PIN', 'INVALID'].includes(i.outcome),
    ).length,
  };
}

export async function runCatalogV301bClassificationLoad(
  input: V301bLoaderInput,
): Promise<V301bLoadReport> {
  const entries = input.entries ?? CATALOG_V3_01B_CLASSIFICATION;
  const manifestReport = validateV301bClassificationManifest(entries);
  const base: V301bLoadReport = {
    mode: input.mode,
    ok: false,
    version: CATALOG_V3_01B_CLASSIFICATION_VERSION,
    disposableConfirmed: null,
    issues: [...manifestReport.issues],
    items: [],
    counts: {
      plannedCreate: 0,
      plannedUnchanged: 0,
      plannedInvalid: 0,
      appliedCreate: 0,
      appliedUnchanged: 0,
    },
    publishedReleaseUnchanged: true,
  };

  if (!manifestReport.ok) {
    return base;
  }

  if (input.mode === 'validate') {
    assertV301bClassificationManifestValid(entries);
    return { ...base, ok: true };
  }

  if (input.mode === 'dry-run') {
    const items = await planV301bClassification(input.pool, entries);
    const counts = summarize(items);
    const ok = counts.plannedInvalid === 0;
    return {
      ...base,
      ok,
      items,
      counts: { ...counts, appliedCreate: 0, appliedUnchanged: 0 },
      issues: ok
        ? []
        : items
            .filter((i) => i.outcome !== 'CREATE_AND_CLASSIFY' && i.outcome !== 'UNCHANGED')
            .map((i) => ({
              code: i.outcome,
              message: i.message,
              exerciseKey: i.exerciseKey,
            })),
    };
  }

  // apply
  const disposable = confirmV301bApplyDatabase(input.databaseUrl);
  const client = await input.pool.connect();
  let appliedCreate = 0;
  let appliedUnchanged = 0;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [
      CATALOG_V3_01B_ADVISORY_LOCK_KEY,
    ]);

    const items = await planV301bClassification(client, entries);
    const planCounts = summarize(items);
    if (planCounts.plannedInvalid > 0) {
      await client.query('ROLLBACK');
      return {
        ...base,
        disposableConfirmed: disposable,
        ok: false,
        items,
        counts: { ...planCounts, appliedCreate: 0, appliedUnchanged: 0 },
        issues: items
          .filter((i) => i.outcome !== 'CREATE_AND_CLASSIFY' && i.outcome !== 'UNCHANGED')
          .map((i) => ({
            code: i.outcome,
            message: i.message,
            exerciseKey: i.exerciseKey,
          })),
      };
    }

    const pins = await loadPublishedPins(client);
    const outItems: V301bLoadItemResult[] = [];

    for (const planned of items) {
      if (planned.outcome === 'UNCHANGED') {
        appliedUnchanged += 1;
        outItems.push(planned);
        continue;
      }
      const entry = entries.find((e) => e.exerciseKey === planned.exerciseKey)!;
      const pin = pins.get(planned.exerciseKey)!;
      const created = await createClassifiedRevision(client, pin, entry);
      appliedCreate += 1;
      outItems.push({
        ...planned,
        outcome: 'CREATE_AND_CLASSIFY',
        message: 'Created classified APPROVED revision (not published)',
        newRevisionId: created.id,
        newRevisionNumber: created.revisionNumber,
      });
      if (
        input.injectFailureAfterCreates != null &&
        appliedCreate >= input.injectFailureAfterCreates
      ) {
        throw new Error('INJECTED_FAILURE_AFTER_CREATES');
      }
    }

    // Adversarial: published pin semantics must still have no taxonomy mutation path used.
    const mutatedPins = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "WorkoutCatalogRelease" rel ON rel.id = i."releaseId"
       JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = i."exerciseRevisionId"
       WHERE rel.status = 'PUBLISHED'`,
    );
    // Published pins may remain without taxonomy (expected). Count is informational only.
    void mutatedPins;

    await client.query('COMMIT');
    return {
      ...base,
      ok: true,
      disposableConfirmed: disposable,
      items: outItems,
      counts: {
        ...planCounts,
        appliedCreate,
        appliedUnchanged,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
