export const ACTIVITY_PROVIDER_SOURCES = ["HEALTHKIT", "HEALTH_CONNECT"] as const;
export type ActivityProviderSource = (typeof ACTIVITY_PROVIDER_SOURCES)[number];

export const ACTIVITY_METRIC_TYPES = ["STEPS"] as const;
export type ActivityMetricType = (typeof ACTIVITY_METRIC_TYPES)[number];

export type ActivityDataState = "NO_DATA" | "SYNCED";

export type ActivityTodayView = {
  localDate: string;
  timeZone: string;
  dataState: ActivityDataState;
  steps: number | null;
  source: ActivityProviderSource | null;
  lastSyncedAt: string | null;
  targetSteps: number | null;
  remainingSteps: number | null;
};

export type ActivitySyncSnapshotInput = {
  localDate: string;
  steps: number;
  sourceCalculatedAt: string;
};

export type ActivitySyncStepsInput = {
  operationId: string;
  source: ActivityProviderSource;
  clientInstanceId: string;
  sequence: number;
  timeZone: string;
  snapshots: ActivitySyncSnapshotInput[];
};

export type ActivitySyncResult = {
  accepted: boolean;
  today: ActivityTodayView;
  appliedDates: string[];
};

export type ActivityClock = { now(): Date };

export const SYSTEM_ACTIVITY_CLOCK: ActivityClock = { now: () => new Date() };

export const ACTIVITY_STEPS_MAX = 200_000;
export const ACTIVITY_SYNC_MAX_SNAPSHOTS = 14;
export const ACTIVITY_SYNC_BACKFILL_DAYS = 31;
export const ACTIVITY_SYNC_STALE_HOURS_DEFAULT = 48;

export type ActivityConsentState = "NOT_GRANTED" | "GRANTED" | "REVOKED";
export type ActivityConnectionState = "NOT_CONNECTED" | "CONNECTED" | "DISCONNECTED";
export type ActivitySyncHealth =
  | "BLOCKED_BY_CONSENT"
  | "BLOCKED_BY_DISCONNECT"
  | "NEVER_SYNCED"
  | "HEALTHY"
  | "STALE";
export type ActivityProviderConnectionStatus = "CONNECTED" | "DISCONNECTED";

export type ActivityProviderStatusView = {
  source: ActivityProviderSource;
  consentState: ActivityConsentState;
  connectionState: ActivityConnectionState;
  syncHealth: ActivitySyncHealth;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastSuccessfulSyncAt: string | null;
};

export type ActivityConnectionsView = {
  timeZone: string;
  staleAfterHours: number;
  providers: ActivityProviderStatusView[];
};

/** Strict top-level allowlist for POST /activity/sync/steps. */
export const ACTIVITY_SYNC_TOP_LEVEL_ALLOWED = new Set([
  "operationId",
  "source",
  "clientInstanceId",
  "sequence",
  "timeZone",
  "snapshots",
]);

export const ACTIVITY_SYNC_SNAPSHOT_ALLOWED = new Set([
  "localDate",
  "steps",
  "sourceCalculatedAt",
]);

/**
 * Distributed Activity sync rate limit (PostgreSQL AuthThrottleBucket).
 * 60 requests / 60s per authenticated USER is above normal mobile sync cadence
 * and blocks burst abuse. Not keyed by client-controlled clientInstanceId alone.
 */
export type ActivitySyncRateLimitConfig = {
  windowSeconds: number;
  maxRequests: number;
  blockSeconds: number;
};

export const DEFAULT_ACTIVITY_SYNC_RATE_LIMIT: ActivitySyncRateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 60,
  blockSeconds: 60,
};

/** Consent providerId mapping for HealthPlatformConsent. */
export const ACTIVITY_SOURCE_CONSENT_PROVIDER: Record<ActivityProviderSource, string> = {
  HEALTHKIT: "apple_health",
  HEALTH_CONNECT: "health_connect",
};

export function isActivityProviderSource(value: unknown): value is ActivityProviderSource {
  return (
    typeof value === "string" &&
    (ACTIVITY_PROVIDER_SOURCES as readonly string[]).includes(value)
  );
}

export function assertActivityProviderSourceParam(raw: unknown): ActivityProviderSource {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!isActivityProviderSource(value)) throw new Error("ACTIVITY_SOURCE_UNSUPPORTED");
  return value;
}

export class ActivityStaleHoursConfigError extends Error {
  readonly code = "ACTIVITY_SYNC_STALE_HOURS_INVALID" as const;
  constructor(detail: string) {
    super(`ACTIVITY_SYNC_STALE_HOURS_INVALID: ${detail}`);
    this.name = "ActivityStaleHoursConfigError";
  }
}

/**
 * ACTIVITY_SYNC_STALE_HOURS:
 * - unset / null → default 48
 * - present but empty/whitespace/NaN/0/negative/fraction/>720/junk → fail-fast
 * - integer 1..720 inclusive → used as-is
 */
export function resolveActivityStaleHours(
  envValue: string | undefined = process.env.ACTIVITY_SYNC_STALE_HOURS,
): number {
  if (envValue == null) {
    return ACTIVITY_SYNC_STALE_HOURS_DEFAULT;
  }
  const raw = String(envValue);
  if (raw.trim() === "") {
    throw new ActivityStaleHoursConfigError("value must be an integer from 1 to 720 when set");
  }
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new ActivityStaleHoursConfigError(`not an integer: ${JSON.stringify(trimmed)}`);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24 * 30) {
    throw new ActivityStaleHoursConfigError(`out of range 1..720: ${parsed}`);
  }
  return parsed;
}

/** Fail-fast at API bootstrap when ACTIVITY_SYNC_STALE_HOURS is present but invalid. */
export function assertActivityStaleHoursConfigAtStartup(
  source: NodeJS.ProcessEnv = process.env,
): number {
  return resolveActivityStaleHours(source.ACTIVITY_SYNC_STALE_HOURS);
}

/**
 * Consent vs connection are separate. Priority for syncHealth:
 * 1) consent not GRANTED → BLOCKED_BY_CONSENT
 * 2) connection DISCONNECTED → BLOCKED_BY_DISCONNECT
 * 3) no connection → NEVER_SYNCED (connectionState NOT_CONNECTED)
 * 4) CONNECTED + null lastSuccessfulSyncAt → NEVER_SYNCED
 * 5) CONNECTED + last sync older than threshold → STALE
 * 6) CONNECTED + fresh last sync → HEALTHY
 */
export function resolveActivityProviderStatus(input: {
  source: ActivityProviderSource;
  consentState: ActivityConsentState;
  connectionStatus: ActivityProviderConnectionStatus | null;
  connectedAt: Date | string | null;
  disconnectedAt: Date | string | null;
  lastSuccessfulSyncAt: Date | string | null;
  now: Date;
  staleAfterHours: number;
}): ActivityProviderStatusView {
  const connectionState: ActivityConnectionState =
    input.connectionStatus == null
      ? "NOT_CONNECTED"
      : input.connectionStatus === "CONNECTED"
        ? "CONNECTED"
        : "DISCONNECTED";

  let syncHealth: ActivitySyncHealth;
  if (input.consentState !== "GRANTED") {
    syncHealth = "BLOCKED_BY_CONSENT";
  } else if (connectionState === "DISCONNECTED") {
    syncHealth = "BLOCKED_BY_DISCONNECT";
  } else if (connectionState === "NOT_CONNECTED") {
    syncHealth = "NEVER_SYNCED";
  } else if (input.lastSuccessfulSyncAt == null) {
    syncHealth = "NEVER_SYNCED";
  } else {
    const lastMs = new Date(input.lastSuccessfulSyncAt).getTime();
    const ageMs = input.now.getTime() - lastMs;
    const staleMs = input.staleAfterHours * 60 * 60 * 1000;
    syncHealth = ageMs > staleMs ? "STALE" : "HEALTHY";
  }

  return {
    source: input.source,
    consentState: input.consentState,
    connectionState,
    syncHealth,
    connectedAt: asIsoOrNull(input.connectedAt),
    disconnectedAt: asIsoOrNull(input.disconnectedAt),
    lastSuccessfulSyncAt: asIsoOrNull(input.lastSuccessfulSyncAt),
  };
}

export function resolveConsentStateFromRows(
  rows: Array<{ status: string; revokedAt?: Date | string | null }>,
): ActivityConsentState {
  const granted = rows.some((r) => r.status === "GRANTED");
  if (granted) return "GRANTED";
  const revoked = rows.some((r) => r.status === "REVOKED");
  if (revoked) return "REVOKED";
  return "NOT_GRANTED";
}

function asIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function assertActivityStepsValue(raw: unknown): number {
  if (typeof raw === "string" && raw.trim() !== "") {
    if (!/^\d+$/.test(raw.trim())) throw new Error("ACTIVITY_STEPS_INVALID");
    raw = Number(raw.trim());
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new Error("ACTIVITY_STEPS_INVALID");
  }
  if (raw < 0 || raw > ACTIVITY_STEPS_MAX) throw new Error("ACTIVITY_STEPS_OUT_OF_RANGE");
  return raw;
}

export function assertOperationId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value || value.length > 128) throw new Error("ACTIVITY_OPERATION_ID_REQUIRED");
  return value;
}

export function assertClientInstanceId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (value.length < 8 || value.length > 128) throw new Error("ACTIVITY_CLIENT_INSTANCE_INVALID");
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("ACTIVITY_CLIENT_INSTANCE_INVALID");
  return value;
}

export function assertSequence(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > Number.MAX_SAFE_INTEGER) {
    throw new Error("ACTIVITY_SEQUENCE_INVALID");
  }
  return raw;
}

export function assertLocalDate(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("ACTIVITY_LOCAL_DATE_INVALID");
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m! - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error("ACTIVITY_LOCAL_DATE_INVALID");
  }
  return value;
}

export function assertIsoTimestamp(raw: unknown): string {
  const value = String(raw ?? "").trim();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("ACTIVITY_SOURCE_CALCULATED_AT_INVALID");
  return new Date(ms).toISOString();
}

export function remainingSteps(
  targetSteps: number | null,
  steps: number | null,
): number | null {
  if (targetSteps == null || steps == null) return null;
  return Math.max(0, targetSteps - steps);
}

export function addDaysIso(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Deterministic effective snapshot among candidates for one localDate.
 * Latest receivedAt wins; tie-break sourceType ASC, syncClientId ASC.
 * Never sums values.
 */
export function pickEffectiveSnapshot<
  T extends {
    receivedAt: Date | string;
    sourceType: string;
    syncClientId: string;
    value: number;
  },
>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const aMs = new Date(a.receivedAt).getTime();
    const bMs = new Date(b.receivedAt).getTime();
    if (aMs !== bMs) return bMs - aMs;
    if (a.sourceType !== b.sourceType) return a.sourceType.localeCompare(b.sourceType);
    return a.syncClientId.localeCompare(b.syncClientId);
  })[0]!;
}
