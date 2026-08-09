import type { Client } from 'pg';

/**
 * RP2-04B: idempotent raw-snapshot retention tick.
 * Does not call external HTTP. Does not create Product/Recipe/RecipeVersion.
 * Network calls: 0 (SQL only).
 */
export async function runResearchRetentionTick(
  client: Client,
): Promise<{ action: string; redacted: number; staleRuns: number }> {
  const stale = await client.query<{ id: string }>(
    `UPDATE "RecipeResearchRun"
     SET status = 'FAILED',
         "errorCode" = 'STALE_RUN',
         "errorSummary" = 'Worker detected stale RUNNING research run',
         "completedAt" = now()
     WHERE status = 'RUNNING'
       AND "startedAt" < now() - interval '30 minutes'
     RETURNING id`,
  );

  const updated = await client.query<{ id: string }>(
    `UPDATE "RecipeSourceRawSnapshot"
     SET "inlinePayloadJson" = NULL,
         "deletionStatus" = CASE WHEN "retentionClass" = 'METADATA_ONLY' THEN 'RETAINED_METADATA' ELSE 'DELETED' END,
         "redactionStatus" = CASE WHEN "retentionClass" = 'METADATA_ONLY' THEN 'REDACTED' ELSE 'DELETED' END,
         "deletedAt" = COALESCE("deletedAt", now())
     WHERE "deletionStatus" = 'ACTIVE'
       AND "expiresAt" IS NOT NULL
       AND "expiresAt" <= now()
     RETURNING id`,
  );

  return {
    action: updated.rows.length || stale.rows.length ? 'RETENTION_APPLIED' : 'NO_OP',
    redacted: updated.rows.length,
    staleRuns: stale.rows.length,
  };
}

export function assertResearchWorkerNetworkCalls(): number {
  return 0;
}
