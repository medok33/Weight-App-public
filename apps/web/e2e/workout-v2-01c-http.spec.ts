import { expect, test, type APIRequestContext } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const password = 'WorkoutV201cHttpPass1!';

async function register(request: APIRequestContext, email: string) {
  const response = await request.post(`${api}/auth/register`, {
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { user: { id: string } };
}

function todayDayIndex(now = new Date()): number {
  return (now.getDay() + 6) % 7;
}

async function ensureWorkoutReady(request: APIRequestContext) {
  const today = todayDayIndex();
  const extras = [0, 2, 4, 1, 3, 5, 6].filter((day) => day !== today).slice(0, 2);
  const availableDays = [today, ...extras];

  const userProfile = await request.put(`${api}/profile`, {
    data: {
      displayName: 'Workout HTTP',
      ageYears: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: 'moderate',
      locale: 'ru',
    },
  });
  expect(userProfile.ok(), await userProfile.text()).toBeTruthy();

  // goalKind is required by workout generate setup (from UserGoal, not WorkoutProfile).
  const goal = await request.put(`${api}/goal`, {
    data: { kind: 'lose_weight', target: 72, unit: 'kg' },
  });
  expect(goal.ok(), await goal.text()).toBeTruthy();

  const profile = await request.put(`${api}/workout-plan/profile`, {
    data: {
      trainingLevel: 'BEGINNER',
      trainingPlace: 'HOME',
      workoutsPerWeek: availableDays.length,
      preferredDuration: 'STANDARD',
      availableDays,
      workoutEquipment: ['BODYWEIGHT'],
      preferredActivityTypes: [],
      excludedExerciseKeys: [],
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();

  const generate = await request.post(`${api}/workout-plan/generate`, {
    data: {},
  });
  expect(generate.ok(), await generate.text()).toBeTruthy();
}

test.describe('WORKOUT-V2-01C HTTP auth and isolation', () => {
  test('unauthenticated session endpoints return 401', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const fakeId = '00000000-0000-4000-8000-000000000001';
    const checks = [
      anon.post(`${api}/workout-plan/sessions`, { data: {} }),
      anon.get(`${api}/workout-plan/sessions/active`),
      anon.get(`${api}/workout-plan/sessions/${fakeId}`),
      anon.put(`${api}/workout-plan/sessions/${fakeId}/exercises/${fakeId}/sets/1`, {
        data: { completed: true },
      }),
      anon.post(`${api}/workout-plan/sessions/${fakeId}/exercises/${fakeId}/skip`, { data: {} }),
      anon.post(`${api}/workout-plan/sessions/${fakeId}/exercises/${fakeId}/unskip`, { data: {} }),
      anon.post(`${api}/workout-plan/sessions/${fakeId}/complete`, { data: {} }),
      anon.post(`${api}/workout-plan/sessions/${fakeId}/abandon`, { data: {} }),
    ];
    const results = await Promise.all(checks);
    for (const result of results) {
      expect(result.status(), await result.text()).toBe(401);
    }
    await anon.dispose();
  });

  test('user B cannot read or mutate user A session; client userId ignored', async ({
    playwright,
  }) => {
    const ctxA = await playwright.request.newContext();
    const ctxB = await playwright.request.newContext();
    await register(ctxA, `workout-http-a-${Date.now()}@example.com`);
    await register(ctxB, `workout-http-b-${Date.now()}@example.com`);
    await ensureWorkoutReady(ctxA);
    await ensureWorkoutReady(ctxB);

    const startA = await ctxA.post(`${api}/workout-plan/sessions`, { data: {} });
    expect(startA.ok(), await startA.text()).toBeTruthy();
    const sessionA = (await startA.json()) as {
      id: string;
      userId: string;
      exercises: Array<{ id: string }>;
    };
    const exerciseId = sessionA.exercises[0]!.id;

    const readB = await ctxB.get(`${api}/workout-plan/sessions/${sessionA.id}`);
    expect(readB.status()).toBe(404);

    const setB = await ctxB.put(
      `${api}/workout-plan/sessions/${sessionA.id}/exercises/${exerciseId}/sets/1`,
      { data: { completed: true, userId: sessionA.userId } },
    );
    expect(setB.status()).toBe(404);

    const skipB = await ctxB.post(
      `${api}/workout-plan/sessions/${sessionA.id}/exercises/${exerciseId}/skip`,
      { data: { userId: sessionA.userId } },
    );
    expect(skipB.status()).toBe(404);

    const completeB = await ctxB.post(`${api}/workout-plan/sessions/${sessionA.id}/complete`, {
      data: { confirmIncomplete: true, userId: sessionA.userId },
    });
    expect(completeB.status()).toBe(404);

    const abandonB = await ctxB.post(`${api}/workout-plan/sessions/${sessionA.id}/abandon`, {
      data: { userId: sessionA.userId },
    });
    expect(abandonB.status()).toBe(404);

    const startB = await ctxB.post(`${api}/workout-plan/sessions`, { data: {} });
    expect(startB.ok(), await startB.text()).toBeTruthy();
    const sessionB = (await startB.json()) as { id: string };
    expect(sessionB.id).not.toBe(sessionA.id);

    // Conflict activeSessionId must belong to current user only.
    const todayA = await ctxA.get(`${api}/workout-plan/today`);
    expect(todayA.ok()).toBeTruthy();
    const todayBody = (await todayA.json()) as { dayIndex: number; days: Array<{ dayIndex: number; isRestDay: boolean; exercises: unknown[] }> };
    const otherDay = todayBody.days.find(
      (day) => day.dayIndex !== todayBody.dayIndex && !day.isRestDay && day.exercises.length > 0,
    );
    if (otherDay) {
      const conflict = await ctxA.post(`${api}/workout-plan/sessions`, {
        data: { dayIndex: otherDay.dayIndex },
      });
      expect(conflict.status()).toBe(409);
      const payload = (await conflict.json()) as {
        message?: { activeSessionId?: string } | string;
        activeSessionId?: string;
      };
      const nested =
        payload.message && typeof payload.message === 'object' ? payload.message : null;
      const activeSessionId = nested?.activeSessionId ?? payload.activeSessionId;
      expect(activeSessionId).toBe(sessionA.id);
      expect(activeSessionId).not.toBe(sessionB.id);
    }

    await ctxA.dispose();
    await ctxB.dispose();
  });
});
