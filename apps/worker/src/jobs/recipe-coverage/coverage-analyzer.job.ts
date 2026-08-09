import { Client } from 'pg';

/**
 * RP2-03B: marks scheduled daily dirty + optionally invokes API analyzer tick.
 * Does not implement a second coverage engine — apply stays in Nest RecipeCoverageAnalyzer.
 */
export async function runCoverageAnalyzerTick(client: Client): Promise<{ action: string; detail?: string }> {
  const matrix = 'coverage-core-v1';

  // Fail stale RUNNING runs (crash recovery).
  await client.query(
    `UPDATE "RecipeCoverageAnalysisRun"
     SET status = 'FAILED',
         "errorCode" = 'STALE_RUN',
         "errorSummary" = 'Worker detected stale RUNNING',
         "completedAt" = now()
     WHERE "matrixVersion" = $1
       AND status = 'RUNNING'
       AND "startedAt" < now() - interval '30 minutes'`,
    [matrix],
  );

  const lastFull = await client.query<{ createdAt: Date }>(
    `SELECT "createdAt" FROM "RecipeCoverageAnalysisRun"
     WHERE "matrixVersion" = $1 AND mode = 'FULL' AND "dryRun" = false
       AND status IN ('SUCCEEDED','PARTIAL')
     ORDER BY "createdAt" DESC LIMIT 1`,
    [matrix],
  );
  const lastAt = lastFull.rows[0]?.createdAt ? new Date(lastFull.rows[0].createdAt).getTime() : 0;
  if (Date.now() - lastAt >= 24 * 60 * 60 * 1000) {
    await client.query(
      `INSERT INTO "RecipeCoverageDirtyState" (
         "matrixVersion", "dirtySince", "nextEligibleRunAt", "reasonSetJson",
         "affectedSlotIdsJson", "affectedRecipeVersionIdsJson", "updatedAt"
       ) VALUES ($1, now(), now(), '["SCHEDULED_DAILY"]'::jsonb, '[]'::jsonb, '[]'::jsonb, now())
       ON CONFLICT ("matrixVersion") DO UPDATE SET
         "reasonSetJson" = (
           SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(
             "RecipeCoverageDirtyState"."reasonSetJson" || '["SCHEDULED_DAILY"]'::jsonb
           ) t(x)
         ),
         "nextEligibleRunAt" = LEAST("RecipeCoverageDirtyState"."nextEligibleRunAt", now()),
         "updatedAt" = now()`,
      [matrix],
    );
  }

  const apiBase = process.env.COVERAGE_ANALYZER_API_URL ?? process.env.API_INTERNAL_URL;
  const token = process.env.COVERAGE_ANALYZER_INTERNAL_TOKEN;
  if (!apiBase || !token) {
    return { action: 'DIRTY_MARKED_ONLY', detail: 'API tick skipped (no COVERAGE_ANALYZER_API_URL/TOKEN)' };
  }

  const dirty = await client.query(
    `SELECT 1 FROM "RecipeCoverageDirtyState"
     WHERE "matrixVersion" = $1 AND "nextEligibleRunAt" <= now() LIMIT 1`,
    [matrix],
  );
  if (!dirty.rows[0]) return { action: 'NO_DIRTY' };

  const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/admin/recipe-coverage/dirty/retry`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reason: 'worker dirty tick' }),
  });
  return { action: 'API_RETRY', detail: `status=${res.status}` };
}
