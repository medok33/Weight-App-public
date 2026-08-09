/** Pure worker job for notification delivery attempts (STEP_184). */
export type NotificationDeliveryJob = {
  userId: string;
  notificationId: string;
  channel: 'in_app' | 'email' | 'push';
};

export function createNotificationDeliveryJob(input: NotificationDeliveryJob): NotificationDeliveryJob {
  if (!input.userId || !input.notificationId) throw new Error('NOTIFICATION_JOB_INVALID');
  return Object.freeze({ ...input });
}

export async function processNotificationDeliveryJob(
  job: NotificationDeliveryJob,
  deliver: (job: NotificationDeliveryJob) => Promise<{ status: string }>,
) {
  return deliver(job);
}

export type OutboxRow = { id: string; notificationId: string; channel: NotificationDeliveryJob['channel']; attempts: number };
export type NotificationOutboxStore = {
  claim(limit: number): Promise<OutboxRow[]>;
  deliver(row: OutboxRow): Promise<{ notificationId: string; status: string }>;
};

/** Claims a bounded batch so the polling loop remains restart-safe. */
export async function runNotificationDeliveryBatch(store: NotificationOutboxStore, limit = 20) {
  const claimed = await store.claim(limit);
  return Promise.all(claimed.map(async (row) => {
    const result = await store.deliver(row);
    return { notificationId: result.notificationId, status: result.status };
  }));
}
