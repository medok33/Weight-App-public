import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

test.describe('ACTIVITY-01A HTTP auth', () => {
  test('unauthenticated activity endpoints return 401 and create no rows', async ({
    playwright,
  }) => {
    const anon = await playwright.request.newContext();
    const today = await anon.get(`${api}/activity/today`);
    expect(today.status(), await today.text()).toBe(401);

    const sync = await anon.post(`${api}/activity/sync/steps`, {
      data: {
        operationId: 'anon-op',
        source: 'HEALTHKIT',
        clientInstanceId: 'anon-client-01',
        sequence: 1,
        timeZone: 'UTC',
        snapshots: [
          {
            localDate: '2026-08-04',
            steps: 100,
            sourceCalculatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(sync.status(), await sync.text()).toBe(401);
    const body = await sync.text();
    expect(body).not.toMatch(/100|anon-client|steps/i);

    await anon.dispose();
  });
});
