import { describe, expect, it, vi } from 'vitest';
import { runNotificationDeliveryBatch } from '../jobs/notification-delivery.job';

describe('notification worker batch STEP_184', () => {
  it('claims and delivers without secrets in results', async () => {
    const deliver = vi.fn(async (row: { notificationId: string }) => ({
      notificationId: row.notificationId,
      status: 'SENT',
    }));
    const results = await runNotificationDeliveryBatch({
      claim: async () => [{ id: 'o1', notificationId: 'n1', channel: 'in_app', attempts: 0 }],
      deliver,
    });
    expect(results).toEqual([{ notificationId: 'n1', status: 'SENT' }]);
    expect(JSON.stringify(results)).not.toMatch(/token|secret|password/i);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
