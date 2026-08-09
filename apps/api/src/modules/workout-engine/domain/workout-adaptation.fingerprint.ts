import { createHash } from "node:crypto";
import type {
  AdaptationOption,
  AdaptationSessionSnapshot,
  WorkoutAdaptationIntent,
} from "./workout-adaptation.types";

export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeys(record[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(stableJson(value));
}

/** Canonical option fingerprint bound into preview and re-checked on apply. */
export function computeOptionFingerprint(input: {
  intent: WorkoutAdaptationIntent;
  optionCode: string;
  policyVersion: string;
  catalogReleaseId: string | null;
  sessionVersion: number;
  option: AdaptationOption;
}): string {
  return hashCanonical({
    intent: input.intent,
    optionCode: input.optionCode,
    policyVersion: input.policyVersion,
    catalogReleaseId: input.catalogReleaseId,
    sessionVersion: input.sessionVersion,
    preview: {
      effectiveDayIndex: input.option.preview.effectiveDayIndex,
      effectiveDate: input.option.preview.effectiveDate,
      estimatedMinutes: input.option.preview.estimatedMinutes,
      exercises: input.option.preview.exercises.map((exercise) => ({
        orderIndex: exercise.orderIndex,
        exerciseKey: exercise.exerciseKey,
        exerciseRevisionId: exercise.exerciseRevisionId,
        catalogReleaseId: exercise.catalogReleaseId,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
        targetDurationSeconds: exercise.targetDurationSeconds,
        restSeconds: exercise.restSeconds,
      })),
    },
    goalImpact: input.option.goalImpact,
  });
}

export function computeSessionStateHash(snapshot: AdaptationSessionSnapshot): string {
  return hashCanonical({
    effectiveDayIndex: snapshot.effectiveDayIndex,
    effectiveDate: snapshot.effectiveDate,
    dayTitle: snapshot.dayTitle,
    estimatedMinutes: snapshot.estimatedMinutes,
    catalogReleaseId: snapshot.catalogReleaseId,
    exercises: snapshot.exercises.map((exercise) => ({
      orderIndex: exercise.orderIndex,
      exerciseKey: exercise.exerciseKey,
      exerciseRevisionId: exercise.exerciseRevisionId,
      catalogReleaseId: exercise.catalogReleaseId,
      targetSets: exercise.targetSets,
      targetRepsMin: exercise.targetRepsMin,
      targetRepsMax: exercise.targetRepsMax,
      targetDurationSeconds: exercise.targetDurationSeconds,
      restSeconds: exercise.restSeconds,
      displayNameRu: exercise.displayNameRu,
    })),
  });
}

export function computeApplyRequestHash(input: {
  action: "APPLY";
  workoutSessionId: string;
  intent: WorkoutAdaptationIntent;
  optionCode: string;
  expectedSessionVersion: number;
  expectedCatalogReleaseId: string | null;
  policyVersion: string;
  optionFingerprint: string;
}): string {
  return hashCanonical(input);
}

export function computeUndoRequestHash(input: {
  action: "UNDO";
  workoutSessionId: string;
  adaptationId: string;
  expectedSessionVersion: number;
}): string {
  return hashCanonical(input);
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const IANA_TIMEZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$|^UTC$/;

/** Resolve Monday=0…Sunday=6 in an IANA timezone (never server local getDay). */
export function dayIndexInTimeZone(timeZone: string, instant = new Date()): number {
  const tz = normalizeTimeZone(timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .formatToParts(instant)
    .find((part) => part.type === "weekday")?.value;
  const index = weekday ? WEEKDAY_TO_INDEX[weekday] : undefined;
  if (index == null) throw new Error("WORKOUT_TIMEZONE_INVALID");
  return index;
}

export function dateOnlyInTimeZone(timeZone: string, instant = new Date()): string {
  const tz = normalizeTimeZone(timeZone);
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function normalizeTimeZone(timeZone: string | null | undefined): string {
  const raw = (timeZone ?? "UTC").trim();
  if (!raw) return "UTC";
  if (raw === "UTC" || raw === "Etc/UTC") return "UTC";
  if (!IANA_TIMEZONE_RE.test(raw)) throw new Error("WORKOUT_TIMEZONE_INVALID");
  try {
    // Throws RangeError for unknown IANA zones in modern Node.
    Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
  } catch {
    throw new Error("WORKOUT_TIMEZONE_INVALID");
  }
  return raw;
}
