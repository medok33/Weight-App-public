import { Client } from 'pg';
import { runNotificationDeliveryBatch, type OutboxRow } from './jobs/notification-delivery.job.js';
import { runCoverageAnalyzerTick } from './jobs/recipe-coverage/coverage-analyzer.job.js';
import { runResearchRetentionTick } from './jobs/recipe-research/research-retention.job.js';

async function pollOnce(client: Client) {
  return runNotificationDeliveryBatch({
    async claim(limit) {
      const result = await client.query<OutboxRow>(`WITH candidates AS (
        SELECT id FROM "NotificationOutbox" WHERE status='PENDING' AND "availableAt" <= CURRENT_TIMESTAMP
        ORDER BY "availableAt" FOR UPDATE SKIP LOCKED LIMIT $1
      ) UPDATE "NotificationOutbox" o SET status='PROCESSING',"updatedAt"=CURRENT_TIMESTAMP
        FROM candidates WHERE o.id=candidates.id
        RETURNING o.id,o."notificationId" AS "notificationId",o.channel,o.attempts`, [limit]);
      return result.rows;
    },
    async deliver(row) {
      const context = await client.query<{ userId: string; category: string; active: boolean; channels: Record<string, boolean>; categoryOpts: Record<string, boolean>; quietHoursStart: string | null; quietHoursEnd: string | null; timezone: string | null }>(
        `SELECT n."userId" AS "userId",n.category, u.status='ACTIVE' AS active,
          COALESCE(p.channels,'{}'::jsonb) AS channels, COALESCE(p."categoryOpts",'{}'::jsonb) AS "categoryOpts",
          p."quietHoursStart",p."quietHoursEnd",p.timezone
         FROM "Notification" n JOIN "User" u ON u.id=n."userId"
         LEFT JOIN "NotificationPreference" p ON p."userId"=n."userId" WHERE n.id=$1::uuid`, [row.notificationId]);
      const item = context.rows[0];
      const attempt = row.attempts + 1;
      if (!item?.active) return finish(client, row, attempt, 'DEAD', 'USER_INACTIVE');
      const decision = deliveryDecision(item, row.channel);
      if (decision.deferUntil) {
        await client.query(`UPDATE "NotificationOutbox" SET status='PENDING',"availableAt"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [row.id, decision.deferUntil]);
        return { notificationId: row.notificationId, status: 'DEFERRED' };
      }
      if (decision.skip) {
        await client.query(`INSERT INTO "DeliveryAttempt" ("notificationId",channel,status,attempt,"errorCode") VALUES ($1::uuid,$2,'SKIPPED',$3,'CHANNEL_OR_CATEGORY_DISABLED')`, [row.notificationId,row.channel,attempt]);
        await client.query(`UPDATE "NotificationOutbox" SET status='DONE',"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [row.id]);
        return { notificationId: row.notificationId, status: 'SKIPPED' };
      }
      if (row.channel !== 'in_app') return finish(client, row, attempt, attempt >= 3 ? 'RETRY_EXHAUSTED' : 'FAILED', 'PROVIDER_NOT_CONFIGURED');
      await client.query(`UPDATE "Notification" SET status='SENT' WHERE id=$1::uuid`, [row.notificationId]);
      await client.query(`INSERT INTO "DeliveryAttempt" ("notificationId",channel,status,attempt) VALUES ($1::uuid,$2,'SENT',$3)`, [row.notificationId, row.channel, attempt]);
      await client.query(`UPDATE "NotificationOutbox" SET status='DONE',"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [row.id]);
      return { notificationId: row.notificationId, status: 'SENT' };
    },
  });
}

function deliveryDecision(item: { category: string; channels: Record<string, boolean>; categoryOpts: Record<string, boolean>; quietHoursStart: string | null; quietHoursEnd: string | null; timezone: string | null }, channel: string) {
  const channels = {
    in_app: true,
    email: true,
    push: false,
    ...(item.channels ?? {}),
  };
  const mandatory = item.category === 'security' && (channel === 'in_app' || channel === 'email');
  if (!mandatory && (!channels[channel] || item.categoryOpts?.[item.category] === false)) return { skip: true };
  if (mandatory || !item.quietHoursStart || !item.quietHoursEnd) return {};
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: item.timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const current = `${parts.find((p) => p.type === 'hour')?.value}:${parts.find((p) => p.type === 'minute')?.value}`;
  const quiet = item.quietHoursStart <= item.quietHoursEnd ? current >= item.quietHoursStart && current < item.quietHoursEnd : current >= item.quietHoursStart || current < item.quietHoursEnd;
  if (!quiet) return {};
  const [hour, minute] = item.quietHoursEnd.split(':').map(Number);
  const deferUntil = new Date(); deferUntil.setUTCHours(hour, minute, 0, 0);
  if (deferUntil <= new Date()) deferUntil.setUTCDate(deferUntil.getUTCDate() + 1);
  return { deferUntil };
}

async function finish(client: Client, row: OutboxRow, attempt: number, status: string, error: string) {
  const dead = status === 'DEAD' || status === 'RETRY_EXHAUSTED';
  await client.query(`INSERT INTO "DeliveryAttempt" ("notificationId",channel,status,attempt,"errorCode") VALUES ($1::uuid,$2,$3,$4,$5)`, [row.notificationId, row.channel, status, attempt, error]);
  await client.query(`UPDATE "NotificationOutbox" SET status=$2,attempts=$3,"lastError"=$4,"availableAt"=CURRENT_TIMESTAMP + ($3 * interval '2 seconds'),"updatedAt"=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [row.id, dead ? 'DEAD' : 'PENDING', attempt, error]);
  return { notificationId: row.notificationId, status };
}

async function startWorker() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const timers: NodeJS.Timeout[] = [];
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(JSON.stringify({ event: 'worker.shutdown', signal }));
    for (const timer of timers) clearInterval(timer);
    try {
      await client.end();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const run = async () => {
    const results = await pollOnce(client);
    for (const result of results) console.info(JSON.stringify(result));
  };
  const coverageTick = async () => {
    try {
      const result = await runCoverageAnalyzerTick(client);
      console.info(JSON.stringify({ job: 'coverage-analyzer', ...result }));
    } catch (error) {
      console.error('coverage analyzer tick failed', error instanceof Error ? error.message : 'unknown');
    }
  };
  const researchRetentionTick = async () => {
    try {
      const result = await runResearchRetentionTick(client);
      console.info(JSON.stringify({ job: 'research-retention', networkCalls: 0, ...result }));
    } catch (error) {
      console.error('research retention tick failed', error instanceof Error ? error.message : 'unknown');
    }
  };
  await run();
  await coverageTick();
  await researchRetentionTick();
  if (process.env.ONCE === '1') return client.end();
  timers.push(setInterval(() => void run().catch((error) => console.error('notification poll failed', error instanceof Error ? error.message : 'unknown')), Number(process.env.NOTIFICATION_POLL_MS ?? 2000)));
  timers.push(setInterval(() => void coverageTick(), Number(process.env.COVERAGE_ANALYZER_POLL_MS ?? 60_000)));
  timers.push(setInterval(() => void researchRetentionTick(), Number(process.env.RESEARCH_RETENTION_POLL_MS ?? 60_000)));
  console.info(JSON.stringify({ event: 'worker.ready', pid: process.pid }));
}

void startWorker();
