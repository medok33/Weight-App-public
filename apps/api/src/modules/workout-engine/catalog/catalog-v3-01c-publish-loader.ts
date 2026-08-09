/**
 * CATALOG-V3-01C-PUBLISH-BRIDGE — controlled DRAFT release candidate (156 pins).
 * Modes: validate | dry-run | apply.
 *
 * Flow (apply):
 *   ensure 01B classification + Batch A + Batch B content on disposable DB
 *   → INSERT/rebuild DRAFT release with exactly 156 pins
 *   → NEVER publish / activate (current PUBLISHED pin set stays authoritative)
 *
 * Does NOT: mutate historical releases, invent readiness, copy Energy/Timing/Media,
 * change Generator algorithm, touch shared/staging/prod, create migration 220.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { runCatalogV301bClassificationLoad } from './catalog-v3-01b-classification-loader';
import {
  DISPOSABLE_DB_NAME_PATTERN,
  normalizeHostname,
} from './catalog-v3-01b-classification-loader';
import { runCatalogV301cAContentLoad } from './catalog-v3-01c-a-content-loader';
import { runCatalogV301cBContentLoad } from './catalog-v3-01c-b-content-loader';
import {
  CATALOG_V3_01C_PUBLISH_ADVISORY_LOCK_KEY,
  CATALOG_V3_01C_PUBLISH_CREATED_BY,
  CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS,
  CATALOG_V3_01C_PUBLISH_MANIFEST_VERSION,
  CATALOG_V3_01C_PUBLISH_PIN_COUNT,
  CATALOG_V3_01C_PUBLISH_RELEASE_CODE,
  CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT,
  CATALOG_V3_01C_PUBLISH_VERSION,
} from './catalog-v3-01c-publish';
import { inspectDatabaseUrl } from '../../../test-support/assert-disposable-database';

const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type V301cPublishMode = 'validate' | 'dry-run' | 'apply';

export type V301cPublishOutcome =
  | 'CANDIDATE'
  | 'UNCHANGED'
  | 'CONTENT_REQUIRED'
  | 'PIN_COUNT_MISMATCH'
  | 'INVALID_STATE';

export type V301cPublishIssue = {
  code: string;
  message: string;
  exerciseKey?: string;
};

export type V301cPublishReport = {
  mode: V301cPublishMode;
  ok: boolean;
  version: typeof CATALOG_V3_01C_PUBLISH_VERSION;
  disposableConfirmed: string | null;
  publishedReleaseCode: string | null;
  publishedReleaseId: string | null;
  publishedPinCount: number;
  candidateReleaseCode: typeof CATALOG_V3_01C_PUBLISH_RELEASE_CODE;
  candidateReleaseId: string | null;
  candidateStatus: 'DRAFT' | null;
  pinCount: number;
  activeCatalogCount: number;
  outcome: V301cPublishOutcome;
  issues: V301cPublishIssue[];
  /** Candidate stays DRAFT — Generator still resolves current PUBLISHED only. */
  generatorRuntimeUnchanged: true;
  publishedReleaseUnchanged: boolean;
};

export type V301cPublishInput = {
  mode: V301cPublishMode;
  pool: Pool;
  databaseUrl?: string | null;
  /** When true (default on apply), ensure classify + Batch A + Batch B first. */
  ensureContent?: boolean;
};

export function confirmV301cPublishApplyDatabase(
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

async function countActiveCatalog(client: Pool | PoolClient): Promise<number> {
  const res = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM "Exercise" e
     WHERE e."isActive" = true AND e.key IS NOT NULL`,
  );
  return Number(res.rows[0]?.c ?? 0);
}

async function countEligiblePublished(
  client: Pool | PoolClient,
  publishedReleaseId: string,
): Promise<number> {
  const res = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
     JOIN "Exercise" e ON e.id = i."exerciseId"
     WHERE i."releaseId" = $1
       AND i."enabledForGenerator" = true
       AND r.status = 'APPROVED'
       AND r."exerciseId" = i."exerciseId"
       AND e."familyId" IS NOT DISTINCT FROM i."familyId"
       AND e."isActive" IS TRUE
       AND e.key IS NOT NULL`,
    [publishedReleaseId],
  );
  return Number(res.rows[0]?.c ?? 0);
}

type PinRow = {
  exerciseId: string;
  exerciseRevisionId: string;
  ordinal: number;
  enabledForGenerator: boolean;
  exerciseKey: string;
};

async function planCandidatePins(
  client: Pool | PoolClient,
  publishedReleaseId: string,
): Promise<{ pins: PinRow[]; issues: V301cPublishIssue[] }> {
  const issues: V301cPublishIssue[] = [];
  const sourcePinCount = await countPinsOnRelease(client, publishedReleaseId);
  if (sourcePinCount !== CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT) {
    issues.push({
      code: 'SOURCE_PIN_COUNT',
      message: `Current published release has ${sourcePinCount} pins, expected ${CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT}`,
    });
  }

  const active = await countActiveCatalog(client);
  if (active !== CATALOG_V3_01C_PUBLISH_PIN_COUNT) {
    issues.push({
      code: 'ACTIVE_CATALOG_COUNT',
      message: `Active catalog has ${active} keys, expected ${CATALOG_V3_01C_PUBLISH_PIN_COUNT}`,
    });
  }

  const planned = await client.query<{
    exerciseId: string;
    exerciseRevisionId: string | null;
    ordinal: number;
    enabledForGenerator: boolean;
    exerciseKey: string;
  }>(
    `WITH published_pins AS (
       SELECT
         i."exerciseId",
         e.key AS "exerciseKey",
         i.ordinal,
         i."enabledForGenerator"
       FROM "WorkoutCatalogReleaseItem" i
       JOIN "Exercise" e ON e.id = i."exerciseId"
       WHERE i."releaseId" = $1
         AND e.key IS NOT NULL
     ),
     new_active AS (
       SELECT
         e.id AS "exerciseId",
         e.key AS "exerciseKey",
         ($2::int + ROW_NUMBER() OVER (ORDER BY e.key ASC))::int AS ordinal,
         true AS "enabledForGenerator"
       FROM "Exercise" e
       WHERE e."isActive" = true
         AND e.key IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM published_pins p WHERE p."exerciseId" = e.id
         )
     ),
     candidates AS (
       SELECT "exerciseId", "exerciseKey", ordinal, "enabledForGenerator"
       FROM published_pins
       UNION ALL
       SELECT "exerciseId", "exerciseKey", ordinal, "enabledForGenerator"
       FROM new_active
     )
     SELECT
       c."exerciseId",
       c."exerciseKey",
       c.ordinal,
       c."enabledForGenerator",
       rev.id AS "exerciseRevisionId"
     FROM candidates c
     LEFT JOIN LATERAL (
       SELECT r.id
       FROM "ExerciseRevision" r
       JOIN "ExerciseRevisionTaxonomy" t ON t."exerciseRevisionId" = r.id
       WHERE r."exerciseId" = c."exerciseId"
         AND r.status = 'APPROVED'
       ORDER BY r."revisionNumber" DESC
       LIMIT 1
     ) rev ON true
     ORDER BY c.ordinal ASC`,
    [publishedReleaseId, CATALOG_V3_01C_PUBLISH_SOURCE_PIN_COUNT],
  );

  const pins: PinRow[] = [];
  for (const row of planned.rows) {
    if (CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS.includes(row.exerciseKey as (typeof CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS)[number])) {
      issues.push({
        code: 'FORBIDDEN_KEY_PLANNED',
        message: `Forbidden/held key planned for pin: ${row.exerciseKey}`,
        exerciseKey: row.exerciseKey,
      });
      continue;
    }
    if (!row.exerciseRevisionId) {
      issues.push({
        code: 'MISSING_APPROVED_TAXONOMY_REVISION',
        message: `No APPROVED revision with taxonomy for ${row.exerciseKey}`,
        exerciseKey: row.exerciseKey,
      });
      continue;
    }
    pins.push({
      exerciseId: row.exerciseId,
      exerciseRevisionId: row.exerciseRevisionId,
      ordinal: row.ordinal,
      enabledForGenerator: row.enabledForGenerator,
      exerciseKey: row.exerciseKey,
    });
  }

  if (pins.length !== CATALOG_V3_01C_PUBLISH_PIN_COUNT && issues.length === 0) {
    issues.push({
      code: 'PIN_COUNT_MISMATCH',
      message: `Planned ${pins.length} pins, expected ${CATALOG_V3_01C_PUBLISH_PIN_COUNT}`,
    });
  }

  const dupKeys = new Set<string>();
  const seen = new Set<string>();
  for (const p of pins) {
    if (seen.has(p.exerciseKey)) dupKeys.add(p.exerciseKey);
    seen.add(p.exerciseKey);
  }
  for (const key of dupKeys) {
    issues.push({
      code: 'DUPLICATE_CANONICAL_KEY',
      message: `Duplicate planned pin key: ${key}`,
      exerciseKey: key,
    });
  }

  return { pins, issues };
}

async function fingerprintPins(pins: PinRow[]): Promise<string> {
  return pins
    .map(
      (p) =>
        `${p.ordinal}:${p.exerciseKey}:${p.exerciseId}:${p.exerciseRevisionId}:${p.enabledForGenerator ? 1 : 0}`,
    )
    .join('|');
}

async function readCandidateFingerprint(
  client: Pool | PoolClient,
  releaseId: string,
): Promise<string | null> {
  const res = await client.query<{
    ordinal: number;
    exerciseKey: string;
    exerciseId: string;
    exerciseRevisionId: string;
    enabledForGenerator: boolean;
  }>(
    `SELECT i.ordinal, e.key AS "exerciseKey", i."exerciseId", i."exerciseRevisionId", i."enabledForGenerator"
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "Exercise" e ON e.id = i."exerciseId"
     WHERE i."releaseId" = $1
     ORDER BY i.ordinal ASC`,
    [releaseId],
  );
  if (!res.rows.length) return null;
  return fingerprintPins(
    res.rows.map((r) => ({
      ordinal: r.ordinal,
      exerciseKey: r.exerciseKey,
      exerciseId: r.exerciseId,
      exerciseRevisionId: r.exerciseRevisionId,
      enabledForGenerator: r.enabledForGenerator,
    })),
  );
}

async function isCandidateAlreadyCorrect(
  client: Pool | PoolClient,
  publishedReleaseId: string,
): Promise<{ ok: boolean; releaseId: string | null; issues: V301cPublishIssue[] }> {
  const existing = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM "WorkoutCatalogRelease" WHERE code = $1`,
    [CATALOG_V3_01C_PUBLISH_RELEASE_CODE],
  );
  if (!existing.rows[0]) {
    return { ok: false, releaseId: null, issues: [] };
  }
  if (existing.rows[0].status !== 'DRAFT') {
    return {
      ok: false,
      releaseId: existing.rows[0].id,
      issues: [
        {
          code: 'INVALID_CANDIDATE_STATUS',
          message: `Candidate release status is ${existing.rows[0].status}; expected DRAFT`,
        },
      ],
    };
  }
  const planned = await planCandidatePins(client, publishedReleaseId);
  if (planned.issues.length || planned.pins.length !== CATALOG_V3_01C_PUBLISH_PIN_COUNT) {
    return { ok: false, releaseId: existing.rows[0].id, issues: planned.issues };
  }
  const expected = await fingerprintPins(planned.pins);
  const actual = await readCandidateFingerprint(client, existing.rows[0].id);
  if (actual !== expected) {
    return { ok: false, releaseId: existing.rows[0].id, issues: [] };
  }
  return { ok: true, releaseId: existing.rows[0].id, issues: [] };
}

async function insertCandidatePins(
  client: PoolClient,
  releaseId: string,
  pins: PinRow[],
): Promise<void> {
  for (const pin of pins) {
    await client.query(
      `INSERT INTO "WorkoutCatalogReleaseItem" (
         "releaseId", "exerciseId", "exerciseRevisionId", "familyId",
         ordinal, "enabledForGenerator"
       )
       SELECT $1, e.id, $2, e."familyId", $3, $4
       FROM "Exercise" e
       WHERE e.id = $5
         AND e."isActive" = true
         AND e.key IS NOT NULL
         AND e."familyId" IS NOT NULL`,
      [
        releaseId,
        pin.exerciseRevisionId,
        pin.ordinal,
        pin.enabledForGenerator,
        pin.exerciseId,
      ],
    );
  }
  const count = await countPinsOnRelease(client, releaseId);
  if (count !== CATALOG_V3_01C_PUBLISH_PIN_COUNT) {
    throw new Error(
      `PIN_COUNT_MISMATCH: inserted ${count}, expected ${CATALOG_V3_01C_PUBLISH_PIN_COUNT}`,
    );
  }
}

async function upsertDraftCandidate(
  client: PoolClient,
  publishedReleaseId: string,
): Promise<string> {
  const planned = await planCandidatePins(client, publishedReleaseId);
  if (planned.issues.length || planned.pins.length !== CATALOG_V3_01C_PUBLISH_PIN_COUNT) {
    const detail = planned.issues
      .slice(0, 8)
      .map((i) => `${i.code}:${i.exerciseKey ?? ''}:${i.message}`)
      .join(';');
    throw new Error(`CANDIDATE_PLAN_FAILED:${detail}`);
  }

  const existing = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM "WorkoutCatalogRelease" WHERE code = $1`,
    [CATALOG_V3_01C_PUBLISH_RELEASE_CODE],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'PUBLISHED') {
      throw new Error('INVALID_STATE:CANDIDATE_ALREADY_PUBLISHED');
    }
    if (existing.rows[0].status !== 'DRAFT') {
      throw new Error(`INVALID_STATE:CANDIDATE_RELEASE_STATUS_${existing.rows[0].status}`);
    }
    await client.query(`DELETE FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1`, [
      existing.rows[0].id,
    ]);
    await insertCandidatePins(client, existing.rows[0].id, planned.pins);
    return existing.rows[0].id;
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO "WorkoutCatalogRelease" (
       id, code, status, "manifestVersion", "createdBy", notes
     ) VALUES ($1, $2, 'DRAFT', $3, $4, $5)
     RETURNING id`,
    [
      randomUUID(),
      CATALOG_V3_01C_PUBLISH_RELEASE_CODE,
      CATALOG_V3_01C_PUBLISH_MANIFEST_VERSION,
      CATALOG_V3_01C_PUBLISH_CREATED_BY,
      'CATALOG-V3-01C-PUBLISH-BRIDGE: DRAFT 156-pin candidate; NOT activated; Generator runtime unchanged',
    ],
  );
  const releaseId = created.rows[0]!.id;
  await insertCandidatePins(client, releaseId, planned.pins);
  return releaseId;
}

async function assertNoForbiddenPins(
  client: PoolClient,
  releaseId: string,
): Promise<void> {
  const forbidden = await client.query<{ key: string }>(
    `SELECT e.key
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "Exercise" e ON e.id = i."exerciseId"
     WHERE i."releaseId" = $1
       AND e.key = ANY($2::text[])`,
    [releaseId, [...CATALOG_V3_01C_PUBLISH_FORBIDDEN_KEYS]],
  );
  if (forbidden.rows.length) {
    throw new Error(
      `FORBIDDEN_KEY_PINNED:${forbidden.rows.map((r) => r.key).join(',')}`,
    );
  }
}

async function assertNoFakeReadiness(
  client: PoolClient,
  releaseId: string,
): Promise<void> {
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
         OR rd."catalogReady" IS TRUE
       )`,
    [releaseId],
  );
  if (Number(readiness.rows[0]?.c ?? 0) > 0) {
    throw new Error('FAKE_READINESS_PRESENT');
  }
}

async function ensurePrerequisiteContent(
  pool: Pool,
  databaseUrl: string | null | undefined,
): Promise<V301cPublishIssue[]> {
  const issues: V301cPublishIssue[] = [];
  const classify = await runCatalogV301bClassificationLoad({
    mode: 'apply',
    pool,
    databaseUrl,
  });
  if (!classify.ok) {
    issues.push(
      ...classify.issues.map((i) => ({
        code: `CLASSIFY_${i.code}`,
        message: i.message,
        exerciseKey: i.exerciseKey,
      })),
    );
    return issues;
  }

  const batchA = await runCatalogV301cAContentLoad({
    mode: 'apply',
    pool,
    databaseUrl,
  });
  if (!batchA.ok) {
    issues.push(
      ...batchA.issues.slice(0, 12).map((i) => ({
        code: `BATCH_A_${i.code}`,
        message: i.message,
        exerciseKey: i.exerciseKey,
      })),
    );
    return issues;
  }

  const batchB = await runCatalogV301cBContentLoad({
    mode: 'apply',
    pool,
    databaseUrl,
  });
  if (!batchB.ok) {
    issues.push(
      ...batchB.issues.slice(0, 12).map((i) => ({
        code: `BATCH_B_${i.code}`,
        message: i.message,
        exerciseKey: i.exerciseKey,
      })),
    );
  }
  return issues;
}

export async function runCatalogV301cPublishLoad(
  input: V301cPublishInput,
): Promise<V301cPublishReport> {
  const base: V301cPublishReport = {
    mode: input.mode,
    ok: false,
    version: CATALOG_V3_01C_PUBLISH_VERSION,
    disposableConfirmed: null,
    publishedReleaseCode: null,
    publishedReleaseId: null,
    publishedPinCount: 0,
    candidateReleaseCode: CATALOG_V3_01C_PUBLISH_RELEASE_CODE,
    candidateReleaseId: null,
    candidateStatus: null,
    pinCount: 0,
    activeCatalogCount: 0,
    outcome: 'INVALID_STATE',
    issues: [],
    generatorRuntimeUnchanged: true,
    publishedReleaseUnchanged: true,
  };

  if (input.mode === 'validate') {
    return {
      ...base,
      ok: true,
      outcome: 'UNCHANGED',
    };
  }

  const pub = await getPublishedRelease(input.pool);
  if (!pub) {
    return {
      ...base,
      issues: [{ code: 'NO_PUBLISHED_RELEASE', message: 'No PUBLISHED catalog release' }],
      outcome: 'INVALID_STATE',
      publishedReleaseUnchanged: false,
    };
  }
  base.publishedReleaseCode = pub.code;
  base.publishedReleaseId = pub.id;
  base.publishedPinCount = await countPinsOnRelease(input.pool, pub.id);
  base.activeCatalogCount = await countActiveCatalog(input.pool);

  if (input.mode === 'dry-run') {
    const planned = await planCandidatePins(input.pool, pub.id);
    if (planned.issues.length) {
      const contentIssue = planned.issues.some(
        (i) =>
          i.code === 'ACTIVE_CATALOG_COUNT' ||
          i.code === 'MISSING_APPROVED_TAXONOMY_REVISION',
      );
      return {
        ...base,
        ok: false,
        outcome: contentIssue ? 'CONTENT_REQUIRED' : 'PIN_COUNT_MISMATCH',
        pinCount: planned.pins.length,
        issues: planned.issues,
      };
    }
    return {
      ...base,
      ok: true,
      outcome: 'CANDIDATE',
      pinCount: planned.pins.length,
      candidateStatus: 'DRAFT',
    };
  }

  // apply
  const disposable = confirmV301cPublishApplyDatabase(input.databaseUrl);

  // Fast idempotent path: if DRAFT fingerprint already matches, do not re-run
  // content loaders (Batch B may have deprecated Batch-A keys such as lat_pulldown_wide).
  const preAlready = await isCandidateAlreadyCorrect(input.pool, pub.id);
  if (preAlready.ok) {
    return {
      ...base,
      disposableConfirmed: disposable,
      ok: true,
      outcome: 'UNCHANGED',
      candidateReleaseId: preAlready.releaseId,
      candidateStatus: 'DRAFT',
      pinCount: CATALOG_V3_01C_PUBLISH_PIN_COUNT,
      publishedReleaseCode: pub.code,
      publishedReleaseId: pub.id,
      publishedPinCount: base.publishedPinCount,
      activeCatalogCount: await countActiveCatalog(input.pool),
      publishedReleaseUnchanged: true,
    };
  }
  if (preAlready.issues.some((i) => i.code === 'INVALID_CANDIDATE_STATUS')) {
    return {
      ...base,
      disposableConfirmed: disposable,
      ok: false,
      outcome: 'INVALID_STATE',
      issues: preAlready.issues,
      candidateReleaseId: preAlready.releaseId,
    };
  }

  const ensureContent = input.ensureContent !== false;
  if (ensureContent) {
    const contentIssues = await ensurePrerequisiteContent(input.pool, input.databaseUrl);
    if (contentIssues.length) {
      return {
        ...base,
        disposableConfirmed: disposable,
        ok: false,
        outcome: 'CONTENT_REQUIRED',
        issues: contentIssues,
        activeCatalogCount: await countActiveCatalog(input.pool),
      };
    }
  }

  const publishedPinsBefore = await input.pool.query<{
    exerciseId: string;
    exerciseRevisionId: string;
    ordinal: number;
    enabledForGenerator: boolean;
  }>(
    `SELECT "exerciseId", "exerciseRevisionId", ordinal, "enabledForGenerator"
     FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1
     ORDER BY ordinal`,
    [pub.id],
  );
  const eligibleBefore = await countEligiblePublished(input.pool, pub.id);

  const client = await input.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [
      CATALOG_V3_01C_PUBLISH_ADVISORY_LOCK_KEY,
    ]);

    const lockedPub = await getPublishedRelease(client);
    if (!lockedPub) {
      throw new Error('NO_PUBLISHED_RELEASE');
    }

    const already = await isCandidateAlreadyCorrect(client, lockedPub.id);
    if (already.ok) {
      await client.query('COMMIT');
      return {
        ...base,
        disposableConfirmed: disposable,
        ok: true,
        outcome: 'UNCHANGED',
        candidateReleaseId: already.releaseId,
        candidateStatus: 'DRAFT',
        pinCount: CATALOG_V3_01C_PUBLISH_PIN_COUNT,
        publishedReleaseCode: lockedPub.code,
        publishedReleaseId: lockedPub.id,
        publishedPinCount: await countPinsOnRelease(input.pool, lockedPub.id),
        activeCatalogCount: await countActiveCatalog(input.pool),
        publishedReleaseUnchanged: true,
      };
    }
    if (already.issues.some((i) => i.code === 'INVALID_CANDIDATE_STATUS')) {
      await client.query('ROLLBACK');
      return {
        ...base,
        disposableConfirmed: disposable,
        ok: false,
        outcome: 'INVALID_STATE',
        issues: already.issues,
        candidateReleaseId: already.releaseId,
      };
    }

    const draftId = await upsertDraftCandidate(client, lockedPub.id);
    await assertNoForbiddenPins(client, draftId);
    await assertNoFakeReadiness(client, draftId);

    // Historical / current PUBLISHED must remain untouched (status + pin identities).
    const hist = await client.query<{ status: string; code: string }>(
      `SELECT status, code FROM "WorkoutCatalogRelease" WHERE id = $1`,
      [lockedPub.id],
    );
    if (hist.rows[0]?.status !== 'PUBLISHED') {
      throw new Error('PUBLISHED_RELEASE_STATUS_CHANGED');
    }
    const histPins = await client.query<{
      exerciseId: string;
      exerciseRevisionId: string;
      ordinal: number;
      enabledForGenerator: boolean;
    }>(
      `SELECT "exerciseId", "exerciseRevisionId", ordinal, "enabledForGenerator"
       FROM "WorkoutCatalogReleaseItem" WHERE "releaseId" = $1
       ORDER BY ordinal`,
      [lockedPub.id],
    );
    if (JSON.stringify(histPins.rows) !== JSON.stringify(publishedPinsBefore.rows)) {
      throw new Error('PUBLISHED_RELEASE_MUTATED');
    }

    const candidateStatus = await client.query<{ status: string }>(
      `SELECT status FROM "WorkoutCatalogRelease" WHERE id = $1`,
      [draftId],
    );
    if (candidateStatus.rows[0]?.status !== 'DRAFT') {
      throw new Error('CANDIDATE_NOT_DRAFT');
    }

    // Activation forbidden in this package — never leave more than one PUBLISHED,
    // and never publish this candidate.
    const publishedCount = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "WorkoutCatalogRelease" WHERE status = 'PUBLISHED'`,
    );
    if (Number(publishedCount.rows[0]?.c ?? 0) !== 1) {
      throw new Error('PUBLISHED_COUNT_UNEXPECTED');
    }
    const accidentalPublish = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "WorkoutCatalogRelease"
       WHERE code = $1 AND status = 'PUBLISHED'`,
      [CATALOG_V3_01C_PUBLISH_RELEASE_CODE],
    );
    if (Number(accidentalPublish.rows[0]?.c ?? 0) !== 0) {
      throw new Error('CANDIDATE_ACCIDENTALLY_PUBLISHED');
    }

    await client.query('COMMIT');

    const eligibleAfter = await countEligiblePublished(input.pool, lockedPub.id);
    if (eligibleAfter !== eligibleBefore) {
      return {
        ...base,
        disposableConfirmed: disposable,
        ok: false,
        outcome: 'INVALID_STATE',
        issues: [
          {
            code: 'GENERATOR_RUNTIME_LEAKAGE',
            message: `Eligible published count changed ${eligibleBefore} → ${eligibleAfter}`,
          },
        ],
        candidateReleaseId: draftId,
        candidateStatus: 'DRAFT',
        pinCount: CATALOG_V3_01C_PUBLISH_PIN_COUNT,
        publishedReleaseUnchanged: false,
      };
    }

    return {
      ...base,
      disposableConfirmed: disposable,
      ok: true,
      outcome: 'CANDIDATE',
      publishedReleaseCode: lockedPub.code,
      publishedReleaseId: lockedPub.id,
      publishedPinCount: histPins.rows.length,
      candidateReleaseId: draftId,
      candidateStatus: 'DRAFT',
      pinCount: CATALOG_V3_01C_PUBLISH_PIN_COUNT,
      activeCatalogCount: await countActiveCatalog(input.pool),
      publishedReleaseUnchanged: true,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      disposableConfirmed: disposable,
      ok: false,
      outcome: 'INVALID_STATE',
      issues: [{ code: 'CANDIDATE_FAILED', message }],
      publishedReleaseUnchanged: false,
    };
  } finally {
    client.release();
  }
}
