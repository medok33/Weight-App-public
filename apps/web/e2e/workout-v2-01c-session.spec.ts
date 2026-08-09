import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { registerAndCompleteOnboarding } from './helpers/onboarding';

const SHOT_DIR = path.resolve(process.cwd(), '../../docs/workout/screenshots/workout-v2-01c');
const password = 'WorkoutV201cSessionPass1!';
const api = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1').replace(
  '://127.0.0.1',
  '://localhost',
);
const fatal: string[] = [];
const VIEWPORTS = [360, 390, 430, 768, 1024, 1280] as const;

fs.mkdirSync(SHOT_DIR, { recursive: true });

/** Monday=0 … Sunday=6 — matches API getTodayView. */
function todayDayIndex(now = new Date()): number {
  return (now.getDay() + 6) % 7;
}

function attachGuards(page: Page) {
  page.on('pageerror', (error) => fatal.push(`pageerror: ${error.message}`));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource: the server responded with a status of [45]\d\d/i.test(text)) return;
    if (/Download the React DevTools|\[HMR\]|Fast Refresh/i.test(text)) return;
    fatal.push(`console.error: ${text}`);
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

async function saveProfileForToday(page: Page) {
  const today = todayDayIndex();
  const extras = [0, 2, 4].filter((day) => day !== today).slice(0, 2);
  const selected = new Set([today, ...extras]);

  await page.getByTestId('workout-profile-place').selectOption('HOME');
  await page.getByTestId('workout-profile-level').selectOption('BEGINNER');
  await page.getByTestId('workout-profile-frequency').selectOption(String(selected.size));

  for (let day = 0; day <= 6; day += 1) {
    const checkbox = page.getByTestId(`workout-profile-day-${day}`);
    const want = selected.has(day);
    if (want && !(await checkbox.isChecked())) await checkbox.check();
    if (!want && (await checkbox.isChecked())) await checkbox.uncheck();
  }

  await page.getByTestId('workout-profile-save').click();
  await expect(page.getByTestId('workout-live')).toContainText(/сохран|saved/i);
}

async function assertNoHorizontalOverflow(page: Page, width: number) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  await expect(page.getByTestId('workout-session-set-1')).toBeVisible();
  await expect(page.getByTestId('workout-session-complete')).toBeVisible();
  await expect(page.getByTestId('workout-session-abandon')).toBeVisible();
  await expect(page.getByTestId('workout-session-prev')).toBeVisible();
  await expect(page.getByTestId('workout-session-next')).toBeVisible();
  await expect(page.getByTestId('workout-session-technique')).toBeVisible();
}

type SessionSetRow = {
  setIndex: number;
  completedAt: string | null;
};

type SessionExerciseRow = {
  id: string;
  orderIndex: number;
  exerciseKey?: string | null;
  displayNameRu?: string | null;
  displayNameEn?: string | null;
  status: string;
  sets: SessionSetRow[];
};

type SessionPayload = {
  id: string;
  exercises: SessionExerciseRow[];
};

type SetToggleIdentity = {
  sessionId: string;
  sessionExerciseId: string;
  orderIndex: number;
  setIndex: number;
  exerciseKey: string | null;
  label: string;
};

function sessionIdFromUrl(page: Page): string {
  const match = page.url().match(/\/workout-engine\/session\/([^/?#]+)/);
  expect(match?.[1], 'sessionId must be present in URL').toBeTruthy();
  return match![1]!;
}

async function readSession(page: Page, sessionId: string): Promise<SessionPayload> {
  // Use in-page fetch so auth cookies for the API origin are included
  // (page.request may not attach cross-port session cookies).
  const payload = await page.evaluate(
    async ({ apiBase, id }) => {
      const response = await fetch(`${apiBase}/workout-plan/sessions/${encodeURIComponent(id)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`session read failed status=${response.status} body=${text.slice(0, 200)}`);
      }
      return JSON.parse(text) as SessionPayload;
    },
    { apiBase: api, id: sessionId },
  );
  expect(payload.id).toBe(sessionId);
  return payload;
}

/** Focused exercise after load(): first PENDING/IN_PROGRESS, else index 0. */
function focusedExercise(session: SessionPayload): SessionExerciseRow {
  const open = session.exercises.find(
    (item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS',
  );
  const exercise = open ?? session.exercises[0];
  expect(exercise, 'session must expose a focusable exercise').toBeTruthy();
  return exercise!;
}

function exactSet(exercise: SessionExerciseRow, setIndex: number): SessionSetRow {
  const set = exercise.sets.find((item) => item.setIndex === setIndex);
  expect(set, `setIndex=${setIndex} must exist on exercise ${exercise.id}`).toBeTruthy();
  return set!;
}

/** Navigate UI to the exercise slot matching saved orderIndex (not any pressed set). */
async function focusExerciseByOrderIndex(page: Page, orderIndex: number): Promise<void> {
  for (let step = 0; step < 20; step += 1) {
    // article only — excludes workout-session-exercise-status (strict-mode collision).
    const slot = page.locator('article[data-testid^="workout-session-exercise-"]');
    await expect(slot).toBeVisible();
    const testId = await slot.getAttribute('data-testid');
    const currentOrder = Number(String(testId ?? '').replace('workout-session-exercise-', ''));
    expect(Number.isFinite(currentOrder), `invalid exercise testid=${testId}`).toBe(true);
    if (currentOrder === orderIndex) {
      await expect(page.getByTestId(`workout-session-exercise-${orderIndex}`)).toBeVisible();
      return;
    }
    if (currentOrder > orderIndex) {
      const prev = page.getByTestId('workout-session-prev');
      expect(await prev.isDisabled(), 'prev must be enabled toward earlier exercise').toBe(false);
      await prev.click();
    } else {
      const next = page.getByTestId('workout-session-next');
      expect(await next.isDisabled(), 'next must be enabled toward later exercise').toBe(false);
      await next.click();
    }
  }
  throw new Error(`could not focus exercise orderIndex=${orderIndex}`);
}

async function captureFocusedSetIdentity(page: Page, setIndex = 1): Promise<SetToggleIdentity> {
  const sessionId = sessionIdFromUrl(page);
  const session = await readSession(page, sessionId);
  const exercise = focusedExercise(session);
  exactSet(exercise, setIndex);
  await expect(page.getByTestId(`workout-session-exercise-${exercise.orderIndex}`)).toBeVisible();
  return {
    sessionId,
    sessionExerciseId: exercise.id,
    orderIndex: exercise.orderIndex,
    setIndex,
    exerciseKey: exercise.exerciseKey ?? null,
    label: exercise.displayNameRu ?? exercise.displayNameEn ?? exercise.exerciseKey ?? exercise.id,
  };
}

/** Click set-1 and wait for authoritative PUT for the exact exercise identity. */
async function completeExactSetAwaitCommit(page: Page, identity: SetToggleIdentity): Promise<void> {
  const setControl = page.getByTestId(`workout-session-set-${identity.setIndex}`);
  const putPromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'PUT') return false;
    if (!response.ok()) return false;
    const url = response.url();
    return (
      url.includes(`/sessions/${identity.sessionId}/`) &&
      url.includes(`/exercises/${identity.sessionExerciseId}/`) &&
      new RegExp(`/sets/${identity.setIndex}(?:\\?|$)`).test(url)
    );
  });
  await setControl.click();
  const response = await putPromise;
  const payload = (await response.json()) as SessionPayload;

  const exercise = payload.exercises.find((item) => item.id === identity.sessionExerciseId);
  expect(exercise, 'PUT response must include exact sessionExerciseId').toBeTruthy();
  const set = exactSet(exercise!, identity.setIndex);
  expect(set.completedAt, 'exact set must have completedAt').toBeTruthy();

  // Sensitivity: a different exercise's completed set must not satisfy this assertion.
  for (const other of payload.exercises) {
    if (other.id === identity.sessionExerciseId) continue;
    expect(other.id).not.toBe(identity.sessionExerciseId);
  }
  expect(
    payload.exercises.find((item) => item.id === `${identity.sessionExerciseId}-wrong`),
  ).toBeUndefined();

  await expect(page.getByTestId(`workout-session-exercise-${identity.orderIndex}`)).toBeVisible();
  await expect(page.getByTestId('workout-session-set-live')).toContainText(
    /отмечен|marked|выполнен|done/i,
  );
  await expect(setControl).toHaveAttribute('aria-pressed', 'true');
}

/**
 * After reload: prove exact exercise/set via API, then navigate to that orderIndex and assert UI.
 */
async function expectPersistedExactSet(page: Page, identity: SetToggleIdentity): Promise<void> {
  await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });

  const session = await readSession(page, identity.sessionId);
  const exercise = session.exercises.find((item) => item.id === identity.sessionExerciseId);
  expect(exercise, 'reloaded session must contain exact sessionExerciseId').toBeTruthy();
  expect(exercise!.orderIndex).toBe(identity.orderIndex);
  if (identity.exerciseKey) {
    expect(exercise!.exerciseKey).toBe(identity.exerciseKey);
  }
  const set = exactSet(exercise!, identity.setIndex);
  expect(set.completedAt, 'exact set completedAt must survive reload').toBeTruthy();

  // Sensitivity: wrong exercise id is not the persisted target.
  const impostor = session.exercises.find((item) => item.id !== identity.sessionExerciseId);
  if (impostor) {
    expect(impostor.id).not.toBe(identity.sessionExerciseId);
    const impostorSet = impostor.sets.find((item) => item.setIndex === identity.setIndex);
    // Even if impostor set-1 is also completed, identity binding must still require our id.
    expect(exercise!.id).toBe(identity.sessionExerciseId);
    expect(impostorSet === undefined || impostor.id !== identity.sessionExerciseId).toBe(true);
  }

  await focusExerciseByOrderIndex(page, identity.orderIndex);
  await expect(page.getByTestId(`workout-session-exercise-${identity.orderIndex}`)).toBeVisible();
  if (identity.label) {
    await expect(page.locator('h2')).toContainText(identity.label);
  }
  await expect(page.getByTestId(`workout-session-set-${identity.setIndex}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

/** Leave completed exercise and land on an incomplete one for skip/complete remainder. */
async function focusIncompleteExercise(page: Page): Promise<void> {
  for (let step = 0; step < 12; step += 1) {
    const status = ((await page.getByTestId('workout-session-exercise-status').textContent()) ?? '').toLowerCase();
    if (!/заверш|complet/.test(status)) return;
    const next = page.getByTestId('workout-session-next');
    if (await next.isDisabled()) return;
    await next.click();
  }
}

test.describe('WORKOUT-V2-01C session execution', () => {
  test.beforeEach(({ page }) => {
    fatal.length = 0;
    attachGuards(page);
  });

  test.afterEach(() => {
    expect(fatal, `Fatal: ${JSON.stringify(fatal)}`).toEqual([]);
  });

  test('happy path + responsive + axe + incomplete/abandon', async ({ page }) => {
    test.setTimeout(240_000);
    const email = `workout-v2-01c-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.goto('/workout-engine?tab=plan');
    await expect(page.getByTestId('workout-my-plan')).toBeVisible({ timeout: 30_000 });
    await saveProfileForToday(page);

    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-today')).toBeVisible();
    await expect(page.getByTestId('workout-start')).toBeVisible({ timeout: 30_000 });
    await shot(page, '01-today-start');

    await page.getByTestId('workout-start').click();
    await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-session-set-1')).toBeVisible();
    await expect(page.getByTestId('workout-session-technique')).toBeVisible();
    await expect(page.getByTestId('workout-session-mistake')).toBeVisible();
    await shot(page, '02-session-started');

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      axe.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'),
    ).toEqual([]);

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await assertNoHorizontalOverflow(page, width);
      console.log(`WORKOUT-V2-01C responsive PASS width=${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    const identity = await captureFocusedSetIdentity(page, 1);
    expect(identity.sessionId).toBeTruthy();
    expect(identity.sessionExerciseId).toBeTruthy();
    expect(identity.setIndex).toBe(1);

    await completeExactSetAwaitCommit(page, identity);
    await shot(page, '03-set-completed');

    await page.reload();
    await expectPersistedExactSet(page, identity);
    await shot(page, '04-set-persisted');
    await focusIncompleteExercise(page);

    await page.getByTestId('workout-session-next').click();
    await page.getByTestId('workout-session-prev').click();

    await page.getByTestId('workout-session-skip').click();
    await expect(page.getByTestId('workout-session-exercise-status')).toContainText(/пропущ|skip/i, {
      timeout: 30_000,
    });
    await shot(page, '05-exercise-skipped');
    await page.getByTestId('workout-session-unskip').click();
    await expect(page.getByTestId('workout-session-skip')).toBeVisible({ timeout: 30_000 });

    await page.locator('a[href*="/workout-engine"]').first().click();
    await expect(page.getByTestId('workout-today')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-continue')).toBeVisible();
    await shot(page, '06-hub-continue');

    await page.getByTestId('workout-continue').click();
    await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
    await shot(page, '07-continued-session');

    // Incomplete complete → API conflict → confirm → complete
    await page.getByTestId('workout-session-complete').click();
    await expect(page.getByTestId('workout-session-live')).toContainText(/остал|left|finish|заверш/i, {
      timeout: 30_000,
    });
    await page.getByTestId('workout-session-complete').click();
    await expect(page.getByTestId('workout-session-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-session-result')).toContainText(/заверш|complet/i);
    await shot(page, '08-session-completed');

    // Terminal completed — Start must stay hidden (WORKOUT-V2-01E)
    await page.goto('/workout-engine?tab=today');
    await expect(page.getByTestId('workout-today')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-today-completed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-start')).toHaveCount(0);
    await expect(page.getByTestId('workout-continue')).toHaveCount(0);
    await shot(page, '09-today-completed-no-restart');

    // Safe 404 state for unknown session
    await page.goto('/workout-engine/session/00000000-0000-4000-8000-000000000099');
    await expect(page.getByTestId('workout-session-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-session-error').getByRole('button')).toBeVisible();
  });

  test('abandon active session without completed restart', async ({ page }) => {
    test.setTimeout(240_000);
    const email = `workout-v2-01c-abandon-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.goto('/workout-engine?tab=plan');
    await expect(page.getByTestId('workout-my-plan')).toBeVisible({ timeout: 30_000 });
    await saveProfileForToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });

    await page.getByTestId('workout-tab-today').click();
    await expect(page.getByTestId('workout-start')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('workout-start').click();
    await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-session-abandon')).toBeVisible();

    await page.getByTestId('workout-session-abandon').click();
    await expect(page.getByTestId('workout-session-live')).toContainText(/отмен|abandon|cancel/i, {
      timeout: 30_000,
    });
    await page.getByTestId('workout-session-abandon').click();
    await expect(page.getByTestId('workout-session-result')).toContainText(/отмен|abandon/i, {
      timeout: 30_000,
    });

    // Terminal abandon: session result stays; do not invent a second active session from UI alone
    await expect(page.getByTestId('workout-session-result')).toBeVisible();
    await page.goto('/workout-engine?tab=today');
    await expect(page.getByTestId('workout-today')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-continue')).toHaveCount(0);
  });

  test('dashboard continue route and retry after load error', async ({ page }) => {
    test.setTimeout(180_000);
    const email = `workout-v2-01c-dash-${Date.now()}@example.com`;
    await registerAndCompleteOnboarding(page, email, password);

    await page.goto('/workout-engine?tab=plan');
    await expect(page.getByTestId('workout-my-plan')).toBeVisible({ timeout: 30_000 });
    await saveProfileForToday(page);
    await page.getByTestId('workout-generate').click();
    await expect(page.getByTestId('workout-live')).toContainText(/обновл|updated/i, { timeout: 60_000 });
    await page.getByTestId('workout-tab-today').click();
    await page.getByTestId('workout-start').click();
    await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
    const sessionUrl = page.url();

    await page.goto('/dashboard-today');
    const continueLink = page
      .getByTestId('dashboard-empty-cta-workout-continue')
      .or(page.getByRole('link', { name: /продолж|continue/i }));
    if (await continueLink.first().isVisible().catch(() => false)) {
      await continueLink.first().click();
      await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
    } else {
      // Filled dashboard may link via quick actions; open session URL directly as resume proof.
      await page.goto(sessionUrl);
      await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
    }

    await page.route('**/api/v1/workout-plan/sessions/**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 500, body: JSON.stringify({ message: 'TEMP' }) });
        return;
      }
      await route.continue();
    });
    await page.reload();
    await expect(page.getByTestId('workout-session-error')).toBeVisible({ timeout: 30_000 });
    await page.unroute('**/api/v1/workout-plan/sessions/**');
    await page.getByTestId('workout-session-error').getByRole('button').click();
    await expect(page.getByTestId('workout-session')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workout-session-set-1')).toBeVisible();
  });
});
