import { expect, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const password = 'Password12345';

async function register(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  anonymousUserId?: string,
) {
  const response = await request.post(`${api}/auth/register`, {
    data: { email, password, anonymousUserId },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { user: { id: string } };
}

test.describe('AI access security — two users', () => {
  test('User B cannot access User A data', async ({ playwright }) => {
    const ctxA = await playwright.request.newContext();
    const ctxB = await playwright.request.newContext();

    const userA = await register(ctxA, `user-a-${Date.now()}@test.com`);
    const userB = await register(ctxB, `user-b-${Date.now()}@test.com`);

    const sendA = await ctxA.post(`${api}/assistant/messages`, {
      data: { content: 'Расскажи про мой рацион' },
    });
    expect(sendA.ok()).toBeTruthy();
    const bodyA = await sendA.json();
    const conversationId = bodyA.conversationId as string;
    const messageId = bodyA.assistantMessage.id as string;

    const readConvB = await ctxB.get(`${api}/assistant/conversations/${conversationId}/messages`);
    expect([400, 403, 404]).toContain(readConvB.status());

    const sendToConvB = await ctxB.post(`${api}/assistant/conversations/${conversationId}/messages`, {
      data: { content: 'взлом' },
    });
    expect([400, 403, 404]).toContain(sendToConvB.status());

    const feedbackB = await ctxB.post(`${api}/assistant/messages/${messageId}/feedback`, {
      data: { rating: 'up' },
    });
    expect([400, 403, 404]).toContain(feedbackB.status());

    const usageA = await ctxA.get(`${api}/assistant/usage`);
    const usageB = await ctxB.get(`${api}/assistant/usage`);
    expect(usageA.ok()).toBeTruthy();
    expect(usageB.ok()).toBeTruthy();
    const usageBodyA = await usageA.json();
    const usageBodyB = await usageB.json();
    expect(usageBodyA.requestCount).toBeGreaterThanOrEqual(1);
    expect(usageBodyB.requestCount).toBe(0);

    await ctxA.dispose();
    await ctxB.dispose();
    expect(userA.user.id).not.toBe(userB.user.id);
  });

  test('logout blocks protected endpoints', async ({ request }) => {
    const email = `session-${Date.now()}@test.com`;
    await register(request, email);

    const me = await request.get(`${api}/auth/me`);
    expect(me.ok()).toBeTruthy();

    await request.post(`${api}/auth/logout`);
    const blocked = await request.get(`${api}/assistant/context`);
    expect(blocked.status()).toBe(401);
  });

  test('off-topic does not increase daily usage count', async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    await register(ctx, `quota-${Date.now()}@test.com`);

    const before = await ctx.get(`${api}/assistant/usage`);
    const beforeCount = (await before.json()).requestCount as number;

    const offTopic = await ctx.post(`${api}/assistant/messages`, {
      data: { content: 'Кто выиграл чемпионат мира по футболу?' },
    });
    expect(offTopic.ok()).toBeTruthy();

    const after = await ctx.get(`${api}/assistant/usage`);
    const afterCount = (await after.json()).requestCount as number;
    expect(afterCount).toBe(beforeCount);

    const valid = await ctx.post(`${api}/assistant/messages`, {
      data: { content: 'Как похудеть безопасно?' },
    });
    expect(valid.ok()).toBeTruthy();

    const finalUsage = await ctx.get(`${api}/assistant/usage`);
    expect((await finalUsage.json()).requestCount).toBe(beforeCount + 1);

    await ctx.dispose();
  });
});
