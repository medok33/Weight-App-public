import type { SqlQuery } from "../../../infrastructure/database/prisma.service";
import {
  DEFAULT_ACTIVITY_SYNC_RATE_LIMIT,
  type ActivitySyncRateLimitConfig,
} from "../domain/activity.types";

/**
 * Shared/distributed rate limit via ActivitySyncRateBucket (PostgreSQL).
 * AuthThrottleBucket cannot host this action (CHECK constrained to auth actions).
 * Redis is health-check only in this codebase — not used for request rate limiting.
 *
 * Keyed by authenticated userId (not client-controlled clientInstanceId).
 * Sync, connect, and disconnect share this per-USER write budget (documented
 * lifecycle + sync abuse protection — not a separate distributed lock stack).
 * On DB failure the error propagates (fail closed with the write path).
 */
export async function assertActivitySyncRateLimit(
  query: SqlQuery,
  userId: string,
  config: ActivitySyncRateLimitConfig = DEFAULT_ACTIVITY_SYNC_RATE_LIMIT,
): Promise<void> {
  const existing = await query<{ blockedUntil: Date | null }>(
    `SELECT "blockedUntil"
     FROM "ActivitySyncRateBucket"
     WHERE "userId" = $1::uuid
     LIMIT 1`,
    [userId],
  );
  const blockedUntil = existing.rows[0]?.blockedUntil;
  if (blockedUntil && new Date(blockedUntil).getTime() > Date.now()) {
    throw new Error("ACTIVITY_SYNC_RATE_LIMITED");
  }

  const result = await query<{ requestCount: number; blockedUntil: Date | null }>(
    `WITH upserted AS (
       INSERT INTO "ActivitySyncRateBucket"
         ("userId", "windowStartedAt", "requestCount", "blockedUntil")
       VALUES ($1::uuid, CURRENT_TIMESTAMP, 1, NULL)
       ON CONFLICT ("userId") DO UPDATE
       SET "requestCount" =
             CASE
               WHEN "ActivitySyncRateBucket"."windowStartedAt" < CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 second') THEN 1
               ELSE "ActivitySyncRateBucket"."requestCount" + 1
             END,
           "windowStartedAt" =
             CASE
               WHEN "ActivitySyncRateBucket"."windowStartedAt" < CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 second') THEN CURRENT_TIMESTAMP
               ELSE "ActivitySyncRateBucket"."windowStartedAt"
             END,
           "blockedUntil" =
             CASE
               WHEN "ActivitySyncRateBucket"."blockedUntil" IS NOT NULL
                 AND "ActivitySyncRateBucket"."blockedUntil" > CURRENT_TIMESTAMP
                 THEN "ActivitySyncRateBucket"."blockedUntil"
               WHEN (
                 CASE
                   WHEN "ActivitySyncRateBucket"."windowStartedAt" < CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 second') THEN 1
                   ELSE "ActivitySyncRateBucket"."requestCount" + 1
                 END
               ) > $3::int
                 THEN CURRENT_TIMESTAMP + ($4::int * INTERVAL '1 second')
               ELSE NULL
             END,
           "updatedAt" = CURRENT_TIMESTAMP
       RETURNING "requestCount", "blockedUntil"
     )
     SELECT "requestCount", "blockedUntil" FROM upserted`,
    [userId, config.windowSeconds, config.maxRequests, config.blockSeconds],
  );

  const row = result.rows[0];
  const nowBlocked =
    row?.blockedUntil != null && new Date(row.blockedUntil).getTime() > Date.now();
  if (nowBlocked || Number(row?.requestCount ?? 0) > config.maxRequests) {
    throw new Error("ACTIVITY_SYNC_RATE_LIMITED");
  }
}
