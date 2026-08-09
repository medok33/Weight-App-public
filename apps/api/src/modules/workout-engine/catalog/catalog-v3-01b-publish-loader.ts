/**
 * CATALOG-V3-01B-PUBLISH — controlled release bridge.
 * Modes: validate | dry-run | apply.
 *
 * Flow (apply):
 *   ensure 01B classified APPROVED revisions (via classification loader)
 *   → INSERT DRAFT release pinning those 84 revisions
 *   → retire current PUBLISHED + publish DRAFT (advisory lock 21000101)
 *
 * Does NOT: mutate historical releases, invent readiness, copy Energy/Timing/Media,
 * change Generator algorithm, touch shared/staging/prod.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CATALOG_V3_01B_CREATED_BY,
} from './catalog-v3-01b-classification';
import {
  DISPOSABLE_DB_NAME_PATTERN,
  normalizeHostname,
  runCatalogV301bClassificationLoad,
} from './catalog-v3-01b-classification-loader';
import {
  CATALOG_V3_01B_PUBLISH_ADVISORY_LOCK_KEY,
  CATALOG_V3_01B_PUBLISH_CREATED_BY,
  CATALOG_V3_01B_PUBLISH_MANIFEST_VERSION,
  CATALOG_V3_01B_PUBLISH_PIN_COUNT,
  CATALOG_V3_01B_PUBLISH_RELEASE_CODE,
  CATALOG_V3_01B_PUBLISH_VERSION,
} from './catalog-v3-01b-publish';
import { CATALOG_PUBLISH_ADVISORY_LOCK_KEY } from './workout-catalog-release.service';
import { inspectDatabaseUrl } from '../../../test-support/assert-disposable-database';

const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type V301bPublishMode = 'validate' | 'dry-run' | 'apply';

export type V301bPublishOutcome =
  | 'PUBLISH'
  | 'UNCHANGED'
  | 'CLASSIFICATION_REQUIRED'
  | 'PIN_COUNT_MISMATCH'
  | 'MISSING_SUCCESSOR'
  | 'INVALID_STATE';

export type V301bPublishIssue = {
  code: string;
  message: string;
  exerciseKey?: string;
};

export type V301bPublishReport = {
  mode: V301bPublishMode;
  ok: boolean;
  version: typeof CATALOG_V3_01B_PUBLISH_VERSION;
  disposableConfirmed: string | null;
  previousPublishedCode: string | null;
  previousPublishedReleaseId: string | null;
  newReleaseCode: typeof CATALOG_V3_01B_PUBLISH_RELEASE_CODE;
  newReleaseId: string | null;
  pinCount: number;
  successorRevisionCount: number;
  outcome: V301bPublishOutcome;
  issues: V301bPublishIssue[];
  /** Generator algorithm / dual-read of V3 fields is NOT enabled by this package. */
  generatorRuntimeUnchanged: true;
};

export type V301bPublishInput = {
  mode: V301bPublishMode;
  pool: Pool;
  databaseUrl?: string | null;
  /** When true (default on apply), run 01B classification apply first if successors missing. */
  ensureClassification?: boolean;
};

export function confirmV301bPublishApplyDatabase(
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

async function getPublishedRelease(
  client: Pool | PoolClient,
): Promise<{ id: string; code: string } | null> {
  const res = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM "WorkoutCatalogRelease"
     WHERE status = 'PUBLISHED'
     ORDER BY "publishedAt" ASC NULLS LAST, "createdAt" ASC
     LIMIT 1`,
  );
  return res.rows[0] ?? null;
}

async function countPublishedReleases(client: Pool | PoolClient): Promise<number> {
  const res = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
  );
  return Number(res.rows[0]?.c ?? 0);
}

async function count01bSuccessors(client: Pool | PoolClient): Promise<number> {
  const res = await client.query<{ c: string }>(
    `SELECT COUNT(DISTINCT r."exerciseId")::text AS c
     FROM "ExerciseRevision" r
     JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
     WHERE r.status = 'APPROVED'
       AND r."createdBy" = $1`,
    [CATALOG_V3_01B_CREATED_BY],
  );
  return Number(res.rows[0]?.c ?? 0);
}

async function countPinsOnRelease(
  client: Pool | PoolClient,
  releaseId: string,
): Promise<number> {
  const res = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1`,
    [releaseId],
  );
  return Number(res.rows[0]?.c ?? 0);
}

/** True when current PUBLISHED is our bridge with 84 pins → 01B successors + taxonomy. */
async function isBridgeAlreadyPublished(
  client: Pool | PoolClient,
): Promise<{ ok: boolean; releaseId: string | null; issues: V301bPublishIssue[] }> {
  const pub = await getPublishedRelease(client);
  if (!pub || pub.code !== CATALOG_V3_01B_PUBLISH_RELEASE_CODE) {
    return { ok: false, releaseId: pub?.id ?? null, issues: [] };
  }
  const issues: V301bPublishIssue[] = [];
  const pinCount = await countPinsOnRelease(client, pub.id);
  if (pinCount !== CATALOG_V3_01B_PUBLISH_PIN_COUNT) {
    issues.push({
      code: 'PIN_COUNT_MISMATCH',
      message: `Published bridge has ${pinCount} pins, expected ${CATALOG_V3_01B_PUBLISH_PIN_COUNT}`,
    });
  }
  const v3Pins = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
     JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
     WHERE i."releaseId" = $1
       AND r."createdBy" = $2
       AND r.status = 'APPROVED'`,
    [pub.id, CATALOG_V3_01B_CREATED_BY],
  );
  const v3Count = Number(v3Pins.rows[0]?.c ?? 0);
  if (v3Count !== CATALOG_V3_01B_PUBLISH_PIN_COUNT) {
    issues.push({
      code: 'PIN_REVISION_MISMATCH',
      message: `Only ${v3Count}/${CATALOG_V3_01B_PUBLISH_PIN_COUNT} pins point to 01B classified revisions`,
    });
  }
  const dup = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM (
       SELECT "exerciseId" FROM "WorkoutCatalogReleaseItem"
       WHERE "releaseId" = $1
       GROUP BY "exerciseId" HAVING COUNT(*) > 1
     ) d`,
    [pub.id],
  );
  if (Number(dup.rows[0]?.c ?? 0) > 0) {
    issues.push({ code: 'DUPLICATE_PIN', message: 'Duplicate exerciseId pins on bridge release' });
  }
  return { ok: issues.length === 0, releaseId: pub.id, issues };
}

async function planMissingSuccessors(
  client: Pool | PoolClient,
  publishedReleaseId: string,
): Promise<V301bPublishIssue[]> {
  const missing = await client.query<{ key: string }>(
    `SELECT e.key
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "Exercise" e ON e.id = i."exerciseId"
     WHERE i."releaseId" = $1
       AND NOT EXISTS (
         SELECT 1
         FROM "ExerciseRevision" r
         JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
         WHERE r."exerciseId" = e.id
           AND r.status = 'APPROVED'
           AND r."createdBy" = $2
       )
     ORDER BY e.key`,
    [publishedReleaseId, CATALOG_V3_01B_CREATED_BY],
  );
  return missing.rows.map((row) => ({
    code: 'MISSING_SUCCESSOR',
    message: `No 01B classified APPROVED revision for ${row.key}`,
    exerciseKey: row.key,
  }));
}

async function insertDraftPinnedTo01b(
  client: PoolClient,
  sourcePublishedReleaseId: string,
): Promise<string> {
  const existing = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM "WorkoutCatalogRelease" WHERE code = $1`,
    [CATALOG_V3_01B_PUBLISH_RELEASE_CODE],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'PUBLISHED') {
      throw new Error('INVALID_STATE:BRIDGE_ALREADY_PUBLISHED');
    }
    if (existing.rows[0].status === 'DRAFT') {
      // Rebuild pins deterministically for this DRAFT.
      await client.query(
        `DELETE FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1`,
        [existing.rows[0].id],
      );
      await insertPins(client, existing.rows[0].id, sourcePublishedReleaseId);
      return existing.rows[0].id;
    }
    throw new Error(
      `INVALID_STATE:BRIDGE_RELEASE_STATUS_${existing.rows[0].status}`,
    );
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO "WorkoutCatalogRelease" (
       id, code, status, "manifestVersion", "createdBy", notes
     ) VALUES ($1, $2, 'DRAFT', $3, $4, $5)
     RETURNING id`,
    [
      randomUUID(),
      CATALOG_V3_01B_PUBLISH_RELEASE_CODE,
      CATALOG_V3_01B_PUBLISH_MANIFEST_VERSION,
      CATALOG_V3_01B_PUBLISH_CREATED_BY,
      'CATALOG-V3-01B-PUBLISH: pin 01B classified revisions; Generator V3 not enabled',
    ],
  );
  const releaseId = created.rows[0]!.id;
  await insertPins(client, releaseId, sourcePublishedReleaseId);
  return releaseId;
}

async function insertPins(
  client: PoolClient,
  newReleaseId: string,
  sourcePublishedReleaseId: string,
): Promise<void> {
  // One pin per current published exercise; re-point to latest 01B classified revision.
  const inserted = await client.query(
    `INSERT INTO "WorkoutCatalogReleaseItem" (
       "releaseId", "exerciseId", "exerciseRevisionId", "familyId",
       ordinal, "enabledForGenerator"
     )
     SELECT
       $1,
       i."exerciseId",
       v3.id,
       e."familyId",
       i.ordinal,
       i."enabledForGenerator"
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "Exercise" e ON e.id = i."exerciseId"
     JOIN LATERAL (
       SELECT r.id
       FROM "ExerciseRevision" r
       JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
       WHERE r."exerciseId" = e.id
         AND r.status = 'APPROVED'
         AND r."createdBy" = $2
       ORDER BY r."revisionNumber" DESC
       LIMIT 1
     ) v3 ON true
     WHERE i."releaseId" = $3
       AND e."familyId" IS NOT NULL
       AND e.key IS NOT NULL
     ORDER BY i.ordinal ASC`,
    [newReleaseId, CATALOG_V3_01B_CREATED_BY, sourcePublishedReleaseId],
  );
  if (inserted.rowCount !== CATALOG_V3_01B_PUBLISH_PIN_COUNT) {
    throw new Error(
      `PIN_COUNT_MISMATCH: inserted ${inserted.rowCount}, expected ${CATALOG_V3_01B_PUBLISH_PIN_COUNT}`,
    );
  }
}

async function assertDraftPublishable(
  client: PoolClient,
  releaseId: string,
): Promise<void> {
  const rel = await client.query<{ status: string }>(
    `SELECT status FROM "WorkoutCatalogRelease" WHERE id = $1`,
    [releaseId],
  );
  if (rel.rows[0]?.status !== 'DRAFT') {
    throw new Error('WORKOUT_CATALOG_RELEASE_NOT_DRAFT');
  }
  const stats = await client.query<{ itemCount: string; eligibleCount: string; badCount: string }>(
    `SELECT
       COUNT(i.id)::text AS "itemCount",
       COUNT(i.id) FILTER (
         WHERE i."enabledForGenerator" = true
           AND r.status = 'APPROVED'
           AND r."exerciseId" = i."exerciseId"
           AND e."familyId" IS NOT DISTINCT FROM i."familyId"
           AND e."isActive" IS TRUE
           AND e.key IS NOT NULL
       )::text AS "eligibleCount",
       COUNT(i.id) FILTER (
         WHERE r.id IS NULL
            OR r.status IS DISTINCT FROM 'APPROVED'
            OR r."exerciseId" IS DISTINCT FROM i."exerciseId"
            OR e.id IS NULL
            OR e."familyId" IS DISTINCT FROM i."familyId"
            OR e."isActive" IS NOT TRUE
       )::text AS "badCount"
     FROM "WorkoutCatalogReleaseItem" i
     LEFT JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
     LEFT JOIN "Exercise" e ON e.id = i."exerciseId"
     WHERE i."releaseId" = $1`,
    [releaseId],
  );
  const itemCount = Number(stats.rows[0]?.itemCount ?? 0);
  const eligibleCount = Number(stats.rows[0]?.eligibleCount ?? 0);
  const badCount = Number(stats.rows[0]?.badCount ?? 0);
  if (itemCount < 1 || eligibleCount < 1) {
    throw new Error('WORKOUT_CATALOG_RELEASE_EMPTY');
  }
  if (badCount !== 0) {
    throw new Error('WORKOUT_CATALOG_RELEASE_NON_APPROVED');
  }
  if (itemCount !== CATALOG_V3_01B_PUBLISH_PIN_COUNT) {
    throw new Error(`PIN_COUNT_MISMATCH:${itemCount}`);
  }
}

async function publishDraftRelease(
  client: PoolClient,
  releaseId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [
    CATALOG_PUBLISH_ADVISORY_LOCK_KEY,
  ]);
  await assertDraftPublishable(client, releaseId);

  await client.query(
    `UPDATE "WorkoutCatalogRelease"
     SET status = 'RETIRED',
         "retiredAt" = COALESCE("retiredAt", now())
     WHERE status = 'PUBLISHED' AND id <> $1`,
    [releaseId],
  );

  const pub = await client.query(
    `UPDATE "WorkoutCatalogRelease"
     SET status = 'PUBLISHED',
         "publishedAt" = COALESCE("publishedAt", now()),
         "retiredAt" = NULL
     WHERE id = $1 AND status = 'DRAFT'
     RETURNING id`,
    [releaseId],
  );
  if (pub.rowCount !== 1) {
    throw new Error('WORKOUT_CATALOG_RELEASE_PUBLISH_FAILED');
  }

  const count = await countPublishedReleases(client);
  if (count !== 1) {
    throw new Error('WORKOUT_CATALOG_RELEASE_PUBLISH_FAILED');
  }
}

export async function runCatalogV301bPublishLoad(
  input: V301bPublishInput,
): Promise<V301bPublishReport> {
  const base: V301bPublishReport = {
    mode: input.mode,
    ok: false,
    version: CATALOG_V3_01B_PUBLISH_VERSION,
    disposableConfirmed: null,
    previousPublishedCode: null,
    previousPublishedReleaseId: null,
    newReleaseCode: CATALOG_V3_01B_PUBLISH_RELEASE_CODE,
    newReleaseId: null,
    pinCount: 0,
    successorRevisionCount: 0,
    outcome: 'INVALID_STATE',
    issues: [],
    generatorRuntimeUnchanged: true,
  };

  if (input.mode === 'validate') {
    return {
      ...base,
      ok: true,
      outcome: 'UNCHANGED',
      issues: [],
    };
  }

  const pub = await getPublishedRelease(input.pool);
  if (!pub) {
    return {
      ...base,
      issues: [{ code: 'NO_PUBLISHED_RELEASE', message: 'No PUBLISHED catalog release' }],
      outcome: 'INVALID_STATE',
    };
  }
  base.previousPublishedCode = pub.code;
  base.previousPublishedReleaseId = pub.id;

  const already = await isBridgeAlreadyPublished(input.pool);
  if (already.ok) {
    const pinCount = await countPinsOnRelease(input.pool, already.releaseId!);
    return {
      ...base,
      ok: true,
      outcome: 'UNCHANGED',
      newReleaseId: already.releaseId,
      pinCount,
      successorRevisionCount: await count01bSuccessors(input.pool),
      previousPublishedCode: CATALOG_V3_01B_PUBLISH_RELEASE_CODE,
      previousPublishedReleaseId: already.releaseId,
    };
  }
  if (already.issues.length && pub.code === CATALOG_V3_01B_PUBLISH_RELEASE_CODE) {
    return {
      ...base,
      issues: already.issues,
      outcome: 'INVALID_STATE',
      newReleaseId: already.releaseId,
    };
  }

  let successors = await count01bSuccessors(input.pool);
  base.successorRevisionCount = successors;

  if (input.mode === 'dry-run') {
    const missing = await planMissingSuccessors(input.pool, pub.id);
    const pinCount = await countPinsOnRelease(input.pool, pub.id);
    if (pinCount !== CATALOG_V3_01B_PUBLISH_PIN_COUNT) {
      return {
        ...base,
        ok: false,
        outcome: 'PIN_COUNT_MISMATCH',
        pinCount,
        issues: [
          {
            code: 'SOURCE_PIN_COUNT',
            message: `Current published release has ${pinCount} pins, expected ${CATALOG_V3_01B_PUBLISH_PIN_COUNT}`,
          },
        ],
      };
    }
    if (missing.length) {
      return {
        ...base,
        ok: false,
        outcome: 'CLASSIFICATION_REQUIRED',
        pinCount,
        issues: missing,
      };
    }
    if (successors !== CATALOG_V3_01B_PUBLISH_PIN_COUNT) {
      return {
        ...base,
        ok: false,
        outcome: 'MISSING_SUCCESSOR',
        pinCount,
        issues: [
          {
            code: 'SUCCESSOR_COUNT',
            message: `Found ${successors} 01B successors, expected ${CATALOG_V3_01B_PUBLISH_PIN_COUNT}`,
          },
        ],
      };
    }
    return {
      ...base,
      ok: true,
      outcome: 'PUBLISH',
      pinCount: CATALOG_V3_01B_PUBLISH_PIN_COUNT,
    };
  }

  // apply
  const disposable = confirmV301bPublishApplyDatabase(input.databaseUrl);
  const ensureClassification = input.ensureClassification !== false;

  if (successors < CATALOG_V3_01B_PUBLISH_PIN_COUNT && ensureClassification) {
    const classReport = await runCatalogV301bClassificationLoad({
      mode: 'apply',
      pool: input.pool,
      databaseUrl: input.databaseUrl,
    });
    if (!classReport.ok) {
      return {
        ...base,
        disposableConfirmed: disposable,
        ok: false,
        outcome: 'CLASSIFICATION_REQUIRED',
        issues: classReport.issues.map((i) => ({
          code: i.code,
          message: i.message,
          exerciseKey: i.exerciseKey,
        })),
      };
    }
    successors = await count01bSuccessors(input.pool);
    base.successorRevisionCount = successors;
  }

  const client = await input.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [
      CATALOG_V3_01B_PUBLISH_ADVISORY_LOCK_KEY,
    ]);

    // Re-read under lock
    const lockedPub = await getPublishedRelease(client);
    if (!lockedPub) {
      throw new Error('NO_PUBLISHED_RELEASE');
    }
    const lockedAlready = await isBridgeAlreadyPublished(client);
    if (lockedAlready.ok) {
      await client.query('COMMIT');
      return {
        ...base,
        disposableConfirmed: disposable,
        ok: true,
        outcome: 'UNCHANGED',
        newReleaseId: lockedAlready.releaseId,
        previousPublishedCode: CATALOG_V3_01B_PUBLISH_RELEASE_CODE,
        previousPublishedReleaseId: lockedAlready.releaseId,
        pinCount: CATALOG_V3_01B_PUBLISH_PIN_COUNT,
        successorRevisionCount: await count01bSuccessors(client),
      };
    }

    const sourcePinCount = await countPinsOnRelease(client, lockedPub.id);
    if (sourcePinCount !== CATALOG_V3_01B_PUBLISH_PIN_COUNT) {
      throw new Error(`SOURCE_PIN_COUNT:${sourcePinCount}`);
    }

    const missing = await planMissingSuccessors(client, lockedPub.id);
    if (missing.length) {
      await client.query('ROLLBACK');
      return {
        ...base,
        disposableConfirmed: disposable,
        ok: false,
        outcome: 'MISSING_SUCCESSOR',
        issues: missing,
        previousPublishedCode: lockedPub.code,
        previousPublishedReleaseId: lockedPub.id,
      };
    }

    // Snapshot historical release pin revision ids for post-check
    const oldPins = await client.query<{ exerciseId: string; exerciseRevisionId: string }>(
      `SELECT "exerciseId", "exerciseRevisionId"
       FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1
       ORDER BY ordinal`,
      [lockedPub.id],
    );

    const draftId = await insertDraftPinnedTo01b(client, lockedPub.id);
    await publishDraftRelease(client, draftId);

    // Historical release must remain RETIRED with original pin revision ids (immutable rows).
    const hist = await client.query<{ status: string }>(
      `SELECT status FROM "WorkoutCatalogRelease" WHERE id = $1`,
      [lockedPub.id],
    );
    if (hist.rows[0]?.status !== 'RETIRED') {
      throw new Error('HISTORICAL_RELEASE_NOT_RETIRED');
    }
    const histPins = await client.query<{ exerciseId: string; exerciseRevisionId: string }>(
      `SELECT "exerciseId", "exerciseRevisionId"
       FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1
       ORDER BY ordinal`,
      [lockedPub.id],
    );
    if (JSON.stringify(histPins.rows) !== JSON.stringify(oldPins.rows)) {
      throw new Error('HISTORICAL_RELEASE_MUTATED');
    }

    // Publish must not invent readiness TRUE on pinned 01B successors (01B creates none).
    const readiness = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "ExerciseRevisionReadiness" rd
       JOIN "WorkoutCatalogReleaseItem" i ON i."exerciseRevisionId" = rd."exerciseRevisionId"
       WHERE i."releaseId" = $1
         AND (
           rd."generatorReady" IS TRUE
           OR rd."energyReady" IS TRUE
           OR rd."timingReady" IS TRUE
           OR rd."mediaReady" IS TRUE
         )`,
      [draftId],
    );
    if (Number(readiness.rows[0]?.c ?? 0) > 0) {
      throw new Error('FAKE_READINESS_PRESENT');
    }

    await client.query('COMMIT');
    return {
      ...base,
      disposableConfirmed: disposable,
      ok: true,
      outcome: 'PUBLISH',
      previousPublishedCode: lockedPub.code,
      previousPublishedReleaseId: lockedPub.id,
      newReleaseId: draftId,
      pinCount: CATALOG_V3_01B_PUBLISH_PIN_COUNT,
      successorRevisionCount: await count01bSuccessors(input.pool),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      disposableConfirmed: disposable,
      ok: false,
      outcome: 'INVALID_STATE',
      issues: [{ code: 'PUBLISH_FAILED', message }],
    };
  } finally {
    client.release();
  }
}
