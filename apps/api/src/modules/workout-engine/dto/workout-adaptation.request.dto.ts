import {
  WORKOUT_ADAPTATION_INTENTS,
  WORKOUT_ADAPTATION_POLICY_VERSION,
  type WorkoutAdaptationIntent,
} from '../domain/workout-adaptation.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const OPTION_CODE_RE = /^[A-Za-z0-9_]{3,64}$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/i;

export type AdaptationPreviewBody = { intent: WorkoutAdaptationIntent };
export type AdaptationApplyBody = {
  intent: WorkoutAdaptationIntent;
  optionCode: string;
  expectedSessionVersion: number;
  expectedCatalogReleaseId: string | null;
  policyVersion: string;
  optionFingerprint: string;
  idempotencyKey: string;
};
export type AdaptationUndoBody = {
  expectedSessionVersion: number;
  adaptationId: string;
  idempotencyKey: string;
};

function assertObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('WORKOUT_ADAPTATION_REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

function assertAllowed(record: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error('WORKOUT_ADAPTATION_UNKNOWN_FIELD');
  }
}

function assertUuid(value: unknown, code = 'WORKOUT_ADAPTATION_REQUEST_INVALID'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error(code);
  return value;
}

function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_RE.test(value)) {
    throw new Error('WORKOUT_ADAPTATION_IDEMPOTENCY_INVALID');
  }
  return value;
}

export function parseAdaptationPreviewBody(body: unknown): AdaptationPreviewBody {
  const record = assertObject(body);
  assertAllowed(record, new Set(['intent']));
  if (!WORKOUT_ADAPTATION_INTENTS.includes(record.intent as WorkoutAdaptationIntent)) {
    throw new Error('WORKOUT_ADAPTATION_INTENT_INVALID');
  }
  return { intent: record.intent as WorkoutAdaptationIntent };
}

export function parseAdaptationApplyBody(body: unknown): AdaptationApplyBody {
  const record = assertObject(body);
  assertAllowed(
    record,
    new Set([
      'intent',
      'optionCode',
      'expectedSessionVersion',
      'sessionVersion', // legacy alias
      'expectedCatalogReleaseId',
      'catalogReleaseId', // legacy alias
      'policyVersion',
      'optionFingerprint',
      'idempotencyKey',
    ]),
  );
  if (!WORKOUT_ADAPTATION_INTENTS.includes(record.intent as WorkoutAdaptationIntent)) {
    throw new Error('WORKOUT_ADAPTATION_INTENT_INVALID');
  }
  if (typeof record.optionCode !== 'string' || !OPTION_CODE_RE.test(record.optionCode)) {
    throw new Error('WORKOUT_ADAPTATION_OPTION_EXPIRED');
  }
  const versionRaw = record.expectedSessionVersion ?? record.sessionVersion;
  if (typeof versionRaw !== 'number' || !Number.isInteger(versionRaw) || versionRaw < 1) {
    throw new Error('WORKOUT_ADAPTATION_STALE_VERSION');
  }
  const releaseRaw = record.expectedCatalogReleaseId ?? record.catalogReleaseId ?? null;
  const expectedCatalogReleaseId =
    releaseRaw == null ? null : assertUuid(releaseRaw, 'WORKOUT_ADAPTATION_CATALOG_STALE');
  if (record.policyVersion !== WORKOUT_ADAPTATION_POLICY_VERSION) {
    throw new Error('WORKOUT_ADAPTATION_OPTION_EXPIRED');
  }
  if (typeof record.optionFingerprint !== 'string' || !FINGERPRINT_RE.test(record.optionFingerprint)) {
    throw new Error('WORKOUT_ADAPTATION_OPTION_EXPIRED');
  }
  return {
    intent: record.intent as WorkoutAdaptationIntent,
    optionCode: record.optionCode,
    expectedSessionVersion: versionRaw,
    expectedCatalogReleaseId,
    policyVersion: WORKOUT_ADAPTATION_POLICY_VERSION,
    optionFingerprint: record.optionFingerprint.toLowerCase(),
    idempotencyKey: assertIdempotencyKey(record.idempotencyKey),
  };
}

export function parseAdaptationUndoBody(body: unknown): AdaptationUndoBody {
  const record = assertObject(body ?? {});
  assertAllowed(record, new Set(['expectedSessionVersion', 'sessionVersion', 'adaptationId', 'idempotencyKey']));
  const versionRaw = record.expectedSessionVersion ?? record.sessionVersion;
  if (typeof versionRaw !== 'number' || !Number.isInteger(versionRaw) || versionRaw < 1) {
    throw new Error('WORKOUT_ADAPTATION_STALE_VERSION');
  }
  const adaptationId =
    record.adaptationId == null
      ? (() => {
          throw new Error('WORKOUT_ADAPTATION_UNDO_UNAVAILABLE');
        })()
      : assertUuid(record.adaptationId, 'WORKOUT_ADAPTATION_UNDO_UNAVAILABLE');
  return {
    expectedSessionVersion: versionRaw,
    adaptationId,
    idempotencyKey: assertIdempotencyKey(record.idempotencyKey),
  };
}

export function parseSessionIdParam(sessionId: string): string {
  return assertUuid(sessionId, 'WORKOUT_SESSION_NOT_FOUND');
}

export function parseHistoryLimit(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error('WORKOUT_ADAPTATION_REQUEST_INVALID');
  return value;
}
