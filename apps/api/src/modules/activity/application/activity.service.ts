import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService, type SqlQuery } from "../../../infrastructure/database/prisma.service";
import { assertConsent, type HealthConsent } from "../../integrations/domain/integrations.policy";
import {
  dateOnlyInTimeZone,
  normalizeTimeZone,
} from "../../workout-engine/domain/workout-adaptation.fingerprint";
import {
  ACTIVITY_PROVIDER_SOURCES,
  ACTIVITY_SOURCE_CONSENT_PROVIDER,
  ACTIVITY_SYNC_BACKFILL_DAYS,
  ACTIVITY_SYNC_MAX_SNAPSHOTS,
  ACTIVITY_SYNC_SNAPSHOT_ALLOWED,
  ACTIVITY_SYNC_TOP_LEVEL_ALLOWED,
  DEFAULT_ACTIVITY_SYNC_RATE_LIMIT,
  SYSTEM_ACTIVITY_CLOCK,
  addDaysIso,
  assertActivityProviderSourceParam,
  assertActivityStepsValue,
  assertClientInstanceId,
  assertIsoTimestamp,
  assertLocalDate,
  assertOperationId,
  assertSequence,
  isActivityProviderSource,
  pickEffectiveSnapshot,
  remainingSteps,
  resolveActivityProviderStatus,
  resolveActivityStaleHours,
  resolveConsentStateFromRows,
  type ActivityClock,
  type ActivityConnectionsView,
  type ActivityProviderConnectionStatus,
  type ActivityProviderSource,
  type ActivityProviderStatusView,
  type ActivitySyncRateLimitConfig,
  type ActivitySyncResult,
  type ActivitySyncStepsInput,
  type ActivityTodayView,
} from "../domain/activity.types";
import { assertActivitySyncRateLimit } from "./activity-sync-throttle";

export const ACTIVITY_CLOCK = "ACTIVITY_CLOCK";
export const ACTIVITY_RATE_LIMIT = "ACTIVITY_RATE_LIMIT";

/**
 * Transaction-scoped advisory lock namespace for provider lifecycle
 * (sync / connect / disconnect) keyed by userId + sourceType.
 */
export const ACTIVITY_PROVIDER_LIFECYCLE_LOCK_NS = 21601001;

type SyncClientRow = {
  id: string;
  userId: string;
  sourceType: string;
  clientInstanceId: string;
  lastAcceptedSequence: string | number;
  lastSuccessfulSyncAt: Date | null;
};

type SnapshotRow = {
  id: string;
  userId: string;
  sourceType: string;
  syncClientId: string;
  localDate: string;
  timeZone: string;
  value: number;
  version: number;
  status: string;
  receivedAt: Date;
  sourceCalculatedAt: Date;
};

type OperationRow = {
  id: string;
  payloadChecksum: string;
  status: string;
  responseSnapshot: unknown;
};

type ConnectionRow = {
  id: string;
  userId: string;
  sourceType: string;
  status: ActivityProviderConnectionStatus;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
};

type PendingEvent = { event: string; source: ActivityProviderSource };

function asIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function checksumPayload(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

/** Canonical steps target — ABSENT in WorkoutPlan/Day for 01A/01B. */
export async function resolveCanonicalTargetSteps(
  userId: string,
  query: SqlQuery,
): Promise<number | null> {
  void userId;
  void query;
  return null;
}

@Injectable()
export class ActivityService {
  private readonly clock: ActivityClock;
  private readonly rateLimit: ActivitySyncRateLimitConfig;
  private readonly staleAfterHours: number;
  private readonly log = new Logger(ActivityService.name);

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Optional() @Inject(ACTIVITY_CLOCK) clock?: ActivityClock,
    @Optional() @Inject(ACTIVITY_RATE_LIMIT) rateLimit?: ActivitySyncRateLimitConfig,
  ) {
    this.clock = clock ?? SYSTEM_ACTIVITY_CLOCK;
    this.rateLimit = rateLimit ?? DEFAULT_ACTIVITY_SYNC_RATE_LIMIT;
    this.staleAfterHours = resolveActivityStaleHours();
  }

  async getToday(userId: string): Promise<ActivityTodayView> {
    const { timeZone, localDate } = await this.resolveTodayContext(userId);
    return this.buildTodayView(userId, timeZone, localDate, this.db.query.bind(this.db) as SqlQuery);
  }

  async listConnections(userId: string): Promise<ActivityConnectionsView> {
    const timeZone = await this.resolveProfileTimeZone(
      userId,
      this.db.query.bind(this.db) as SqlQuery,
    );
    const now = this.clock.now();
    const providers: ActivityProviderStatusView[] = [];
    for (const source of ACTIVITY_PROVIDER_SOURCES) {
      providers.push(
        await this.buildProviderStatus(
          userId,
          source,
          now,
          this.staleAfterHours,
          this.db.query.bind(this.db) as SqlQuery,
        ),
      );
    }
    return { timeZone, staleAfterHours: this.staleAfterHours, providers };
  }

  async connectProvider(
    userId: string,
    sourceRaw: string,
  ): Promise<ActivityProviderStatusView> {
    const source = assertActivityProviderSourceParam(sourceRaw);
    await this.assertLifecycleRateLimit(userId, source);

    const pending: PendingEvent[] = [];
    const view = await this.db.withTransaction(async (tx) => {
      await this.acquireProviderLifecycleLock(tx, userId, source);
      await this.assertActivityConsent(userId, source, tx);

      const before = await this.findConnection(tx, userId, source);
      await tx(
        `INSERT INTO "ActivityProviderConnection" (
           "userId", "sourceType", status, "connectedAt", "disconnectedAt",
           "lastSuccessfulSyncAt"
         ) VALUES ($1, $2, 'CONNECTED', now(), NULL, NULL)
         ON CONFLICT ("userId", "sourceType") DO UPDATE
         SET status = 'CONNECTED',
             "connectedAt" = CASE
               WHEN "ActivityProviderConnection".status IS DISTINCT FROM 'CONNECTED'
                 THEN now()
               ELSE "ActivityProviderConnection"."connectedAt"
             END,
             "disconnectedAt" = NULL,
             "updatedAt" = now()`,
        [userId, source],
      );

      if (!before || before.status !== "CONNECTED") {
        pending.push({ event: "activity_connection_connected", source });
      }

      return this.buildProviderStatus(userId, source, this.clock.now(), this.staleAfterHours, tx);
    });

    this.flushEvents(pending);
    return view;
  }

  async disconnectProvider(
    userId: string,
    sourceRaw: string,
  ): Promise<ActivityProviderStatusView> {
    const source = assertActivityProviderSourceParam(sourceRaw);
    await this.assertLifecycleRateLimit(userId, source);

    const pending: PendingEvent[] = [];
    const view = await this.db.withTransaction(async (tx) => {
      await this.acquireProviderLifecycleLock(tx, userId, source);
      const existing = await this.findConnection(tx, userId, source);
      // No row → stay NOT_CONNECTED (idempotent). Do not invent DISCONNECTED
      // for never-connected providers — first sync may still create CONNECTED.
      if (existing && existing.status !== "DISCONNECTED") {
        const updated = await tx<{ id: string }>(
          `UPDATE "ActivityProviderConnection"
           SET status = 'DISCONNECTED',
               "disconnectedAt" = now(),
               "updatedAt" = now()
           WHERE id = $1 AND status = 'CONNECTED'
           RETURNING id`,
          [existing.id],
        );
        if (updated.rows[0]) {
          pending.push({ event: "activity_connection_disconnected", source });
        }
      }

      return this.buildProviderStatus(userId, source, this.clock.now(), this.staleAfterHours, tx);
    });

    this.flushEvents(pending);
    return view;
  }

  async syncSteps(userId: string, rawBody: Record<string, unknown>): Promise<ActivitySyncResult> {
    this.assertTopLevelAllowlist(rawBody);
    const input = this.parseSyncInput(rawBody);

    const pending: PendingEvent[] = [];
    let committed = false;
    try {
      const result = await this.db.withTransaction(async (tx) => {
        await this.acquireProviderLifecycleLock(tx, userId, input.source);

        const profileZone = await this.resolveProfileTimeZone(userId, tx);
        const requestZone = normalizeTimeZone(input.timeZone);
        if (requestZone !== profileZone) {
          throw new Error("ACTIVITY_TIMEZONE_MISMATCH");
        }

        const payloadChecksum = checksumPayload({
          operationId: input.operationId,
          source: input.source,
          clientInstanceId: input.clientInstanceId,
          sequence: input.sequence,
          timeZone: requestZone,
          snapshots: input.snapshots,
        });

        // Exact ACCEPTED replay before rate limit / consent / disconnect gates.
        // Must not create clients, snapshots, or reconnect a DISCONNECTED provider.
        const existingClient = await this.findClient(
          tx,
          userId,
          input.source,
          input.clientInstanceId,
        );
        if (existingClient) {
          const existingOp = await this.findOperation(
            tx,
            userId,
            input.source,
            existingClient.id,
            input.operationId,
          );
          if (existingOp) {
            if (existingOp.payloadChecksum !== payloadChecksum) {
              pending.push({ event: "activity_sync_conflict", source: input.source });
              throw new Error("ACTIVITY_OPERATION_PAYLOAD_CONFLICT");
            }
            committed = true;
            return this.parseSyncResult(existingOp.responseSnapshot);
          }
        }

        try {
          await assertActivitySyncRateLimit(tx, userId, this.rateLimit);
        } catch (error) {
          if (error instanceof Error && error.message === "ACTIVITY_SYNC_RATE_LIMITED") {
            pending.push({ event: "activity_sync_rate_limited", source: input.source });
          }
          throw error;
        }

        try {
          await this.assertActivityConsent(userId, input.source, tx);
        } catch (error) {
          if (error instanceof Error && error.message === "HEALTH_CONSENT_REQUIRED") {
            pending.push({ event: "activity_sync_blocked_by_consent", source: input.source });
          }
          throw error;
        }

        let connection = await this.findConnection(tx, userId, input.source);
        if (connection?.status === "DISCONNECTED") {
          pending.push({ event: "activity_sync_blocked_by_disconnect", source: input.source });
          throw new Error("ACTIVITY_CONNECTION_DISCONNECTED");
        }

        if (!connection) {
          await tx(
            `INSERT INTO "ActivityProviderConnection" (
               "userId", "sourceType", status, "connectedAt", "disconnectedAt",
               "lastSuccessfulSyncAt"
             ) VALUES ($1, $2, 'CONNECTED', now(), NULL, NULL)`,
            [userId, input.source],
          );
          pending.push({ event: "activity_connection_connected", source: input.source });
          connection = await this.findConnection(tx, userId, input.source);
          if (!connection) throw new Error("ACTIVITY_CONNECTION_MISSING");
        }

        const today = dateOnlyInTimeZone(profileZone, this.clock.now());
        this.validateSnapshotWindow(input.snapshots, today);

        const client = await this.upsertClient(tx, userId, input.source, input.clientInstanceId);

        const racedOp = await this.findOperation(
          tx,
          userId,
          input.source,
          client.id,
          input.operationId,
        );
        if (racedOp) {
          if (racedOp.payloadChecksum !== payloadChecksum) {
            pending.push({ event: "activity_sync_conflict", source: input.source });
            throw new Error("ACTIVITY_OPERATION_PAYLOAD_CONFLICT");
          }
          committed = true;
          return this.parseSyncResult(racedOp.responseSnapshot);
        }

        const lastSeq = Number(client.lastAcceptedSequence);
        if (input.sequence < lastSeq) {
          pending.push({ event: "activity_sync_conflict", source: input.source });
          throw Object.assign(new Error("ACTIVITY_SEQUENCE_STALE"), {
            current: await this.buildTodayView(userId, profileZone, today, tx),
          });
        }
        if (input.sequence === lastSeq && input.snapshots.length > 0) {
          pending.push({ event: "activity_sync_conflict", source: input.source });
          throw Object.assign(new Error("ACTIVITY_SEQUENCE_STALE"), {
            current: await this.buildTodayView(userId, profileZone, today, tx),
          });
        }

        // Final connection gate immediately before writes (lifecycle lock held).
        connection = await this.findConnection(tx, userId, input.source);
        if (!connection || connection.status === "DISCONNECTED") {
          pending.push({ event: "activity_sync_blocked_by_disconnect", source: input.source });
          throw new Error("ACTIVITY_CONNECTION_DISCONNECTED");
        }

        const appliedDates: string[] = [];
        for (const snap of input.snapshots) {
          await this.applySnapshot(tx, {
            userId,
            source: input.source,
            syncClientId: client.id,
            operationId: input.operationId,
            timeZone: requestZone,
            localDate: snap.localDate,
            steps: snap.steps,
            sourceCalculatedAt: snap.sourceCalculatedAt,
          });
          appliedDates.push(snap.localDate);
        }

        await tx(
          `UPDATE "ActivitySyncClient"
           SET "lastAcceptedSequence" = $2,
               "lastSuccessfulSyncAt" = now(),
               "updatedAt" = now()
           WHERE id = $1`,
          [client.id, input.sequence],
        );

        await tx(
          `UPDATE "ActivityProviderConnection"
           SET "lastSuccessfulSyncAt" = now(),
               "updatedAt" = now()
           WHERE id = $1 AND status = 'CONNECTED'`,
          [connection.id],
        );

        const todayView = await this.buildTodayView(userId, profileZone, today, tx);
        const syncResult: ActivitySyncResult = {
          accepted: true,
          today: todayView,
          appliedDates: [...new Set(appliedDates)].sort(),
        };

        await tx(
          `INSERT INTO "ActivitySyncOperation" (
             "userId", "sourceType", "syncClientId", "operationId", sequence,
             "payloadChecksum", status, "responseSnapshot"
           ) VALUES ($1, $2, $3, $4, $5, $6, 'ACCEPTED', $7::jsonb)`,
          [
            userId,
            input.source,
            client.id,
            input.operationId,
            input.sequence,
            payloadChecksum,
            JSON.stringify(syncResult),
          ],
        );

        pending.push({ event: "activity_sync_accepted", source: input.source });
        committed = true;
        return syncResult;
      });

      this.flushEvents(pending);
      return result;
    } catch (error) {
      // Outcome events for rejected requests (not lifecycle transitions on rollback).
      const rejectEvents = pending.filter((item) =>
        [
          "activity_sync_rate_limited",
          "activity_sync_blocked_by_consent",
          "activity_sync_blocked_by_disconnect",
          "activity_sync_conflict",
        ].includes(item.event),
      );
      this.flushEvents(rejectEvents);
      if (
        error instanceof Error &&
        (error.message === "ACTIVITY_SEQUENCE_STALE" ||
          error.message === "ACTIVITY_OPERATION_PAYLOAD_CONFLICT")
      ) {
        // already queued where applicable
      }
      void committed;
      throw error;
    }
  }

  private flushEvents(events: PendingEvent[]) {
    for (const item of events) this.emit(item.event, item.source);
  }

  private emit(event: string, source: ActivityProviderSource) {
    // Outcome-only observability — never log steps, clientInstanceId, or operationId.
    this.log.log(JSON.stringify({ event, source }));
  }

  private async assertLifecycleRateLimit(userId: string, source: ActivityProviderSource) {
    try {
      await assertActivitySyncRateLimit(
        this.db.query.bind(this.db) as SqlQuery,
        userId,
        this.rateLimit,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "ACTIVITY_SYNC_RATE_LIMITED") {
        this.emit("activity_connection_rate_limited", source);
      }
      throw error;
    }
  }

  private async acquireProviderLifecycleLock(
    query: SqlQuery,
    userId: string,
    source: ActivityProviderSource,
  ) {
    // Deterministic key: same userId+sourceType → same lock; different pairs do not contend.
    await query(`SELECT pg_advisory_xact_lock($1, hashtext($2::text))`, [
      ACTIVITY_PROVIDER_LIFECYCLE_LOCK_NS,
      `${userId}:${source}`,
    ]);
  }

  private async buildProviderStatus(
    userId: string,
    source: ActivityProviderSource,
    now: Date,
    staleAfterHours: number,
    query: SqlQuery,
  ): Promise<ActivityProviderStatusView> {
    const providerId = ACTIVITY_SOURCE_CONSENT_PROVIDER[source];
    const consents = await query<{ status: string; revokedAt: Date | null }>(
      `SELECT status, "revokedAt"
       FROM "HealthPlatformConsent"
       WHERE "userId" = $1::uuid
         AND "providerId" = $2
         AND "dataCategory" = 'activity'
         AND direction = 'READ'`,
      [userId, providerId],
    );
    const connection = await this.findConnection(query, userId, source);
    return resolveActivityProviderStatus({
      source,
      consentState: resolveConsentStateFromRows(consents.rows),
      connectionStatus: connection?.status ?? null,
      connectedAt: connection?.connectedAt ?? null,
      disconnectedAt: connection?.disconnectedAt ?? null,
      lastSuccessfulSyncAt: connection?.lastSuccessfulSyncAt ?? null,
      now,
      staleAfterHours,
    });
  }

  /** Read-only connection lookup — never uses FOR UPDATE. */
  private async findConnection(
    query: SqlQuery,
    userId: string,
    source: ActivityProviderSource,
  ): Promise<ConnectionRow | null> {
    const result = await query<ConnectionRow>(
      `SELECT id, "userId", "sourceType", status,
              "connectedAt", "disconnectedAt", "lastSuccessfulSyncAt"
       FROM "ActivityProviderConnection"
       WHERE "userId" = $1 AND "sourceType" = $2
       LIMIT 1`,
      [userId, source],
    );
    return result.rows[0] ?? null;
  }

  private assertTopLevelAllowlist(body: Record<string, unknown>) {
    for (const key of Object.keys(body)) {
      if (!ACTIVITY_SYNC_TOP_LEVEL_ALLOWED.has(key)) {
        throw new Error("ACTIVITY_SYNC_FIELD_FORBIDDEN");
      }
    }
    if (body.source === "MANUAL") throw new Error("ACTIVITY_SOURCE_UNSUPPORTED");
  }

  private parseSyncInput(body: Record<string, unknown>): ActivitySyncStepsInput {
    if (!isActivityProviderSource(body.source)) throw new Error("ACTIVITY_SOURCE_UNSUPPORTED");
    const snapshotsRaw = body.snapshots;
    if (!Array.isArray(snapshotsRaw)) throw new Error("ACTIVITY_SNAPSHOTS_REQUIRED");
    if (snapshotsRaw.length === 0 || snapshotsRaw.length > ACTIVITY_SYNC_MAX_SNAPSHOTS) {
      throw new Error("ACTIVITY_SNAPSHOTS_LIMIT");
    }

    const snapshots = snapshotsRaw.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("ACTIVITY_SNAPSHOT_INVALID");
      }
      const row = item as Record<string, unknown>;
      for (const key of Object.keys(row)) {
        if (!ACTIVITY_SYNC_SNAPSHOT_ALLOWED.has(key)) {
          throw new Error("ACTIVITY_SYNC_FIELD_FORBIDDEN");
        }
      }
      return {
        localDate: assertLocalDate(row.localDate),
        steps: assertActivityStepsValue(row.steps),
        sourceCalculatedAt: assertIsoTimestamp(row.sourceCalculatedAt),
      };
    });

    const dates = new Set(snapshots.map((s) => s.localDate));
    if (dates.size !== snapshots.length) throw new Error("ACTIVITY_SNAPSHOT_DATE_DUPLICATE");

    return {
      operationId: assertOperationId(body.operationId),
      source: body.source,
      clientInstanceId: assertClientInstanceId(body.clientInstanceId),
      sequence: assertSequence(body.sequence),
      timeZone: String(body.timeZone ?? ""),
      snapshots,
    };
  }

  private validateSnapshotWindow(
    snapshots: ActivitySyncStepsInput["snapshots"],
    today: string,
  ) {
    const minDate = addDaysIso(today, -ACTIVITY_SYNC_BACKFILL_DAYS);
    for (const snap of snapshots) {
      if (snap.localDate > today) throw new Error("ACTIVITY_LOCAL_DATE_FUTURE");
      if (snap.localDate < minDate) throw new Error("ACTIVITY_LOCAL_DATE_BACKFILL");
    }
  }

  private async assertActivityConsent(
    userId: string,
    source: ActivityProviderSource,
    query: SqlQuery,
  ) {
    const providerId = ACTIVITY_SOURCE_CONSENT_PROVIDER[source];
    const rows = await query<HealthConsent>(
      `SELECT "userId", "providerId", "dataCategory", direction, purpose, "consentVersion", status
       FROM "HealthPlatformConsent"
       WHERE "userId" = $1::uuid`,
      [userId],
    );
    assertConsent(rows.rows, userId, providerId, "activity", "READ");
  }

  private async resolveProfileTimeZone(userId: string, query: SqlQuery): Promise<string> {
    const profile = await query<{ timezone: string | null }>(
      `SELECT timezone FROM "UserProfile" WHERE "userId" = $1`,
      [userId],
    );
    return normalizeTimeZone(profile.rows[0]?.timezone ?? "UTC");
  }

  private async resolveTodayContext(userId: string): Promise<{ timeZone: string; localDate: string }> {
    const timeZone = await this.resolveProfileTimeZone(
      userId,
      this.db.query.bind(this.db) as SqlQuery,
    );
    return { timeZone, localDate: dateOnlyInTimeZone(timeZone, this.clock.now()) };
  }

  private async findClient(
    query: SqlQuery,
    userId: string,
    source: ActivityProviderSource,
    clientInstanceId: string,
  ): Promise<SyncClientRow | null> {
    const result = await query<SyncClientRow>(
      `SELECT id, "userId", "sourceType", "clientInstanceId",
              "lastAcceptedSequence", "lastSuccessfulSyncAt"
       FROM "ActivitySyncClient"
       WHERE "userId" = $1 AND "sourceType" = $2 AND "clientInstanceId" = $3
       LIMIT 1`,
      [userId, source, clientInstanceId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Atomic first-create: INSERT ... ON CONFLICT DO NOTHING, then SELECT FOR UPDATE.
   * Avoids read-then-insert unique-violation 500 under concurrent first sync.
   */
  private async upsertClient(
    query: SqlQuery,
    userId: string,
    source: ActivityProviderSource,
    clientInstanceId: string,
  ): Promise<SyncClientRow> {
    await query(
      `INSERT INTO "ActivitySyncClient" (
         "userId", "sourceType", "clientInstanceId", "lastAcceptedSequence"
       ) VALUES ($1, $2, $3, 0)
       ON CONFLICT ("userId", "sourceType", "clientInstanceId") DO NOTHING`,
      [userId, source, clientInstanceId],
    );

    const locked = await query<SyncClientRow>(
      `SELECT id, "userId", "sourceType", "clientInstanceId",
              "lastAcceptedSequence", "lastSuccessfulSyncAt"
       FROM "ActivitySyncClient"
       WHERE "userId" = $1 AND "sourceType" = $2 AND "clientInstanceId" = $3
       FOR UPDATE`,
      [userId, source, clientInstanceId],
    );
    if (!locked.rows[0]) {
      throw new Error("ACTIVITY_SYNC_CLIENT_MISSING");
    }
    return locked.rows[0];
  }

  private async findOperation(
    query: SqlQuery,
    userId: string,
    source: ActivityProviderSource,
    syncClientId: string,
    operationId: string,
  ): Promise<OperationRow | null> {
    const result = await query<OperationRow>(
      `SELECT id, "payloadChecksum", status, "responseSnapshot"
       FROM "ActivitySyncOperation"
       WHERE "userId" = $1 AND "sourceType" = $2
         AND "syncClientId" = $3 AND "operationId" = $4
       LIMIT 1`,
      [userId, source, syncClientId, operationId],
    );
    return result.rows[0] ?? null;
  }

  private async applySnapshot(
    query: SqlQuery,
    input: {
      userId: string;
      source: ActivityProviderSource;
      syncClientId: string;
      operationId: string;
      timeZone: string;
      localDate: string;
      steps: number;
      sourceCalculatedAt: string;
    },
  ) {
    const active = await query<SnapshotRow>(
      `SELECT id, "userId", "sourceType", "syncClientId",
              "localDate"::text AS "localDate", "timeZone", value, version, status,
              "receivedAt", "sourceCalculatedAt"
       FROM "ActivityDailySnapshot"
       WHERE "userId" = $1 AND "sourceType" = $2
         AND "localDate" = $3::date AND "metricType" = 'STEPS'
         AND status = 'ACTIVE'
       FOR UPDATE`,
      [input.userId, input.source, input.localDate],
    );

    const prior = active.rows[0];
    if (prior) {
      await query(
        `UPDATE "ActivityDailySnapshot"
         SET status = 'SUPERSEDED', "supersededAt" = now()
         WHERE id = $1 AND status = 'ACTIVE'`,
        [prior.id],
      );
    }

    await query(
      `INSERT INTO "ActivityDailySnapshot" (
         "userId", "sourceType", "syncClientId", "metricType", "localDate", "timeZone",
         value, version, status, "sourceCalculatedAt", "supersedesId", "syncOperationId"
       ) VALUES (
         $1, $2, $3, 'STEPS', $4::date, $5,
         $6, $7, 'ACTIVE', $8::timestamptz, $9, $10
       )`,
      [
        input.userId,
        input.source,
        input.syncClientId,
        input.localDate,
        input.timeZone,
        input.steps,
        prior ? Number(prior.version) + 1 : 1,
        input.sourceCalculatedAt,
        prior?.id ?? null,
        input.operationId,
      ],
    );
  }

  private async buildTodayView(
    userId: string,
    timeZone: string,
    localDate: string,
    query: SqlQuery,
  ): Promise<ActivityTodayView> {
    const rows = await query<SnapshotRow>(
      `SELECT id, "userId", "sourceType", "syncClientId",
              "localDate"::text AS "localDate", "timeZone", value, version, status,
              "receivedAt", "sourceCalculatedAt"
       FROM "ActivityDailySnapshot"
       WHERE "userId" = $1
         AND "localDate" = $2::date
         AND "metricType" = 'STEPS'
         AND status = 'ACTIVE'`,
      [userId, localDate],
    );

    const effective = pickEffectiveSnapshot(rows.rows);
    const steps = effective ? Number(effective.value) : null;
    const targetSteps = await resolveCanonicalTargetSteps(userId, query);
    return {
      localDate,
      timeZone,
      dataState: effective ? "SYNCED" : "NO_DATA",
      steps,
      source: effective ? (effective.sourceType as ActivityProviderSource) : null,
      lastSyncedAt: effective ? asIso(effective.receivedAt) : null,
      targetSteps,
      remainingSteps: remainingSteps(targetSteps, steps),
    };
  }

  private parseSyncResult(snapshot: unknown): ActivitySyncResult {
    const record = snapshot as ActivitySyncResult;
    return {
      accepted: Boolean(record.accepted),
      today: record.today,
      appliedDates: Array.isArray(record.appliedDates)
        ? record.appliedDates.map(String)
        : [],
    };
  }
}
