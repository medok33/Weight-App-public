/**
 * Exact published-release pin binding.
 * FORBIDDEN: revisionNumber=1 constant, latest revision, name/family fallback.
 */
import { createRequire } from 'node:module';
import type { PrismaService } from '../../../../infrastructure/database/prisma.service';
import type { PublishedReleasePin } from './content.types';
import { WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY } from './product-policy';

const requireJson = createRequire(__filename);

export type ReleasePinResolveOk = {
  status: 'OK';
  exerciseKey: string;
  revisionId: string | null;
  revisionNumber: number;
  repetitionMode: PublishedReleasePin['repetitionMode'];
  enabledForGenerator: boolean;
  defaultDurationSeconds: number | null;
};

export type ReleasePinResolveError = {
  status:
    | 'MISSING_REVISION_PIN'
    | 'AMBIGUOUS_REVISION_PIN'
    | 'REVISION_PIN_MISMATCH'
    | 'INVALID_PINNED_REVISION'
    | 'WRONG_RELEASE';
  exerciseKey: string;
  message: string;
  actualRevisionNumber?: number;
  expectedRevisionNumber?: number;
};

export type ReleasePinResolveResult = ReleasePinResolveOk | ReleasePinResolveError;

type CanonicalExercise = {
  key: string;
  revisionNumber: number;
  repetitionMode: PublishedReleasePin['repetitionMode'];
  defaultDurationSeconds: number | null;
};

type CanonicalSoT = {
  releaseCode: string;
  exercises: CanonicalExercise[];
};

const SOT = requireJson('../../catalog/canonical-content-01b.json') as CanonicalSoT;

/** Repository SoT pins for the current published catalog release (no DB). */
export function listPublishedReleasePinsFromSoT(): PublishedReleasePin[] {
  if (SOT.releaseCode !== WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.catalogReleaseKey) {
    throw new Error(
      `WRONG_RELEASE: expected ${WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.catalogReleaseKey}, got ${SOT.releaseCode}`,
    );
  }
  return SOT.exercises.map((ex) => ({
    exerciseKey: ex.key,
    revisionNumber: ex.revisionNumber,
    repetitionMode: ex.repetitionMode,
    enabledForGenerator: true,
    defaultDurationSeconds: ex.defaultDurationSeconds ?? null,
  }));
}

export function resolvePublishedPinFromSoT(
  exerciseKey: string,
  expectedPublishedRevisionNumber?: number,
): ReleasePinResolveResult {
  const matches = SOT.exercises.filter((ex) => ex.key === exerciseKey);
  if (matches.length === 0) {
    return {
      status: 'MISSING_REVISION_PIN',
      exerciseKey,
      message: 'Exercise key absent from published catalog SoT',
    };
  }
  if (matches.length > 1) {
    return {
      status: 'AMBIGUOUS_REVISION_PIN',
      exerciseKey,
      message: 'Multiple SoT rows for exercise key',
    };
  }
  const pin = matches[0]!;
  if (
    expectedPublishedRevisionNumber != null &&
    pin.revisionNumber !== expectedPublishedRevisionNumber
  ) {
    return {
      status: 'REVISION_PIN_MISMATCH',
      exerciseKey,
      message: `Published pin revisionNumber=${pin.revisionNumber} does not match expected ${expectedPublishedRevisionNumber}`,
      actualRevisionNumber: pin.revisionNumber,
      expectedRevisionNumber: expectedPublishedRevisionNumber,
    };
  }
  return {
    status: 'OK',
    exerciseKey,
    revisionId: null,
    revisionNumber: pin.revisionNumber,
    repetitionMode: pin.repetitionMode,
    enabledForGenerator: true,
    defaultDurationSeconds: pin.defaultDurationSeconds ?? null,
  };
}

/**
 * Runtime DB lookup: published catalog release → exact release pin → ExerciseRevision.id.
 * Never uses revisionNumber=1 constant / latest / name fallback.
 */
export async function resolvePublishedPinFromDb(
  db: PrismaService,
  exerciseKey: string,
  expectedPublishedRevisionNumber?: number,
): Promise<ReleasePinResolveResult> {
  const release = await db.query<{ id: string; code: string }>(
    `SELECT id, code
     FROM "WorkoutCatalogRelease"
     WHERE status = 'PUBLISHED'
     ORDER BY "publishedAt" ASC NULLS LAST, "createdAt" ASC
     LIMIT 1`,
  );
  const published = release.rows[0];
  if (!published) {
    return {
      status: 'MISSING_REVISION_PIN',
      exerciseKey,
      message: 'No PUBLISHED catalog release',
    };
  }
  if (published.code !== WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.catalogReleaseKey) {
    return {
      status: 'WRONG_RELEASE',
      exerciseKey,
      message: `Published release code ${published.code} != ${WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY.catalogReleaseKey}`,
    };
  }

  const pins = await db.query<{
    revisionId: string;
    revisionNumber: number;
    revisionStatus: string;
    repetitionMode: PublishedReleasePin['repetitionMode'];
    enabledForGenerator: boolean;
    defaultDurationSeconds: number | null;
  }>(
    `SELECT r.id AS "revisionId",
            r."revisionNumber" AS "revisionNumber",
            r.status AS "revisionStatus",
            r."repetitionMode" AS "repetitionMode",
            i."enabledForGenerator" AS "enabledForGenerator",
            r."defaultDurationSeconds" AS "defaultDurationSeconds"
     FROM "WorkoutCatalogReleaseItem" i
     JOIN "Exercise" e ON e.id = i."exerciseId"
     JOIN "ExerciseRevision" r ON r.id = i."exerciseRevisionId"
     WHERE i."releaseId" = $1::uuid
       AND e.key = $2`,
    [published.id, exerciseKey],
  );

  if (pins.rows.length === 0) {
    return {
      status: 'MISSING_REVISION_PIN',
      exerciseKey,
      message: 'No release pin for exercise key on published release',
    };
  }
  if (pins.rows.length > 1) {
    return {
      status: 'AMBIGUOUS_REVISION_PIN',
      exerciseKey,
      message: 'Multiple release pins for exercise key',
    };
  }

  const pin = pins.rows[0]!;
  if (pin.revisionStatus !== 'APPROVED') {
    return {
      status: 'INVALID_PINNED_REVISION',
      exerciseKey,
      message: `Pinned revision status is ${pin.revisionStatus}, expected APPROVED`,
      actualRevisionNumber: pin.revisionNumber,
    };
  }
  if (
    expectedPublishedRevisionNumber != null &&
    pin.revisionNumber !== expectedPublishedRevisionNumber
  ) {
    return {
      status: 'REVISION_PIN_MISMATCH',
      exerciseKey,
      message: `Published pin revisionNumber=${pin.revisionNumber} does not match expected ${expectedPublishedRevisionNumber}`,
      actualRevisionNumber: pin.revisionNumber,
      expectedRevisionNumber: expectedPublishedRevisionNumber,
    };
  }

  return {
    status: 'OK',
    exerciseKey,
    revisionId: pin.revisionId,
    revisionNumber: pin.revisionNumber,
    repetitionMode: pin.repetitionMode,
    enabledForGenerator: pin.enabledForGenerator,
    defaultDurationSeconds: pin.defaultDurationSeconds,
  };
}

/** Reject hardcoded revisionNumber=1 lookups (adversarial guard helper). */
export function assertNoHardcodedRevisionOneLookup(sql: string): void {
  if (/revisionNumber"\s*=\s*1/.test(sql) || /revisionNumber\s*=\s*1/.test(sql)) {
    throw new Error('HARDCODED_REVISION_NUMBER_1_FORBIDDEN');
  }
}
