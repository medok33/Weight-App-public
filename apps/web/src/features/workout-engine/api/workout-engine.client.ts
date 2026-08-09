import { apiFetch, ApiError } from '@/lib/api-fetch';
import type {
  WorkoutExerciseDetail,
  WorkoutAdaptation,
  WorkoutAdaptationApplyResult,
  WorkoutAdaptationIntent,
  WorkoutAdaptationPreview,
  WorkoutPlanDayOverride,
  WorkoutProfile,
  WorkoutProfilePatch,
  WorkoutReplacementOption,
  WorkoutReplacementType,
  WorkoutSession,
  WorkoutSessionSetPatch,
  WorkoutSetupStatus,
  WorkoutSummary,
  WorkoutToday,
  WorkoutWeek,
} from '../model/workout-engine.types';

async function readErrorPayload(response: Response): Promise<{
  code?: string;
  message?: string;
  activeSessionId?: string;
  incompleteExercises?: number;
  completedExercises?: number;
  skippedExercises?: number;
  totalExercises?: number;
}> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const nested =
      payload.message && typeof payload.message === 'object' && !Array.isArray(payload.message)
        ? (payload.message as Record<string, unknown>)
        : null;
    const messageRaw = nested?.message ?? payload.message ?? payload.code;
    const code = Array.isArray(messageRaw)
      ? String(messageRaw[0] ?? '')
      : typeof messageRaw === 'string'
        ? messageRaw
        : typeof nested?.code === 'string'
          ? nested.code
          : undefined;
    const activeSessionId =
      (typeof nested?.activeSessionId === 'string' && nested.activeSessionId) ||
      (typeof payload.activeSessionId === 'string' ? payload.activeSessionId : undefined);
    const num = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    return {
      code,
      message: code,
      activeSessionId,
      incompleteExercises: num(nested?.incompleteExercises ?? payload.incompleteExercises),
      completedExercises: num(nested?.completedExercises ?? payload.completedExercises),
      skippedExercises: num(nested?.skippedExercises ?? payload.skippedExercises),
      totalExercises: num(nested?.totalExercises ?? payload.totalExercises),
    };
  } catch {
    return {};
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new ApiError(401, 'UNAUTHORIZED');
  if (response.status === 403) throw new ApiError(403, 'FORBIDDEN');
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new ApiError(response.status, payload.code);
  }
  return response.json() as Promise<T>;
}

export async function getWorkoutPlan(): Promise<WorkoutSummary> {
  const response = await apiFetch('/workout-plan');
  return readJson<WorkoutSummary>(response);
}

export async function getWorkoutSetup(): Promise<WorkoutSetupStatus> {
  const response = await apiFetch('/workout-plan/setup');
  return readJson<WorkoutSetupStatus>(response);
}

export async function generateWorkoutPlan(body?: {
  excludedKeys?: string[];
}): Promise<WorkoutSummary> {
  const response = await apiFetch('/workout-plan/generate', {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
  if (response.status === 401) throw new ApiError(401, 'UNAUTHORIZED');
  if (response.status === 403) throw new ApiError(403, 'FORBIDDEN');
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new ApiError(response.status, payload.code ?? 'WORKOUT_PLAN_GENERATE_FAILED');
  }
  return response.json() as Promise<WorkoutSummary>;
}

export async function getWorkoutProfile(): Promise<WorkoutProfile> {
  return readJson<WorkoutProfile>(await apiFetch('/workout-plan/profile'));
}

export async function updateWorkoutProfile(body: WorkoutProfilePatch): Promise<WorkoutProfile> {
  return readJson<WorkoutProfile>(
    await apiFetch('/workout-plan/profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );
}

export async function getWorkoutToday(date?: string): Promise<WorkoutToday> {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return readJson<WorkoutToday>(await apiFetch(`/workout-plan/today${query}`));
}

export async function getWorkoutWeek(): Promise<WorkoutWeek> {
  return readJson<WorkoutWeek>(await apiFetch('/workout-plan/week'));
}

export async function getWorkoutReplacementOptions(
  dayIndex: number,
): Promise<WorkoutReplacementOption[]> {
  return readJson<WorkoutReplacementOption[]>(
    await apiFetch(`/workout-plan/days/${dayIndex}/replacements`),
  );
}

export async function applyWorkoutReplacement(
  dayIndex: number,
  body: { replacementType: WorkoutReplacementType; moveTargetDayIndex?: number },
): Promise<WorkoutPlanDayOverride> {
  return readJson<WorkoutPlanDayOverride>(
    await apiFetch(`/workout-plan/days/${dayIndex}/replacements`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

export async function revertWorkoutReplacement(id: string): Promise<WorkoutPlanDayOverride> {
  return readJson<WorkoutPlanDayOverride>(
    await apiFetch(`/workout-plan/replacements/${encodeURIComponent(id)}/revert`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  );
}

export async function getWorkoutExercise(key: string): Promise<WorkoutExerciseDetail> {
  return readJson<WorkoutExerciseDetail>(
    await apiFetch(`/workout-plan/exercises/${encodeURIComponent(key)}`),
  );
}

export class WorkoutActiveSessionError extends ApiError {
  readonly activeSessionId: string;

  constructor(activeSessionId: string) {
    super(409, 'WORKOUT_ACTIVE_SESSION_EXISTS');
    this.name = 'WorkoutActiveSessionError';
    this.activeSessionId = activeSessionId;
  }
}

export async function startWorkoutSession(body?: {
  dayIndex?: number;
  date?: string;
}): Promise<WorkoutSession> {
  const response = await apiFetch('/workout-plan/sessions', {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
  if (response.status === 401) throw new ApiError(401, 'UNAUTHORIZED');
  if (response.status === 403) throw new ApiError(403, 'FORBIDDEN');
  if (response.status === 409) {
    const payload = await readErrorPayload(response);
    if (payload.activeSessionId) {
      throw new WorkoutActiveSessionError(payload.activeSessionId);
    }
    throw new ApiError(409, payload.code ?? 'WORKOUT_ACTIVE_SESSION_EXISTS');
  }
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new ApiError(response.status, payload.code ?? 'WORKOUT_SESSION_START_FAILED');
  }
  return response.json() as Promise<WorkoutSession>;
}

export async function getActiveWorkoutSession(): Promise<WorkoutSession | null> {
  return readJson<WorkoutSession | null>(await apiFetch('/workout-plan/sessions/active'));
}

export async function getWorkoutSession(sessionId: string): Promise<WorkoutSession> {
  return readJson<WorkoutSession>(
    await apiFetch(`/workout-plan/sessions/${encodeURIComponent(sessionId)}`),
  );
}

export async function previewWorkoutAdaptation(
  sessionId: string,
  intent: WorkoutAdaptationIntent,
): Promise<WorkoutAdaptationPreview> {
  return readJson<WorkoutAdaptationPreview>(
    await apiFetch(`/workout-plan/sessions/${encodeURIComponent(sessionId)}/adaptations/preview`, {
      method: 'POST',
      body: JSON.stringify({ intent }),
    }),
  );
}

export async function applyWorkoutAdaptation(
  sessionId: string,
  body: {
    intent: WorkoutAdaptationIntent;
    optionCode: string;
    expectedSessionVersion: number;
    expectedCatalogReleaseId: string | null;
    policyVersion: string;
    optionFingerprint: string;
    idempotencyKey: string;
  },
): Promise<WorkoutAdaptationApplyResult> {
  return readJson<WorkoutAdaptationApplyResult>(
    await apiFetch(`/workout-plan/sessions/${encodeURIComponent(sessionId)}/adaptations/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

export async function undoWorkoutAdaptation(
  sessionId: string,
  body: { expectedSessionVersion: number; adaptationId?: string; idempotencyKey: string },
): Promise<WorkoutAdaptationApplyResult> {
  return readJson<WorkoutAdaptationApplyResult>(
    await apiFetch(`/workout-plan/sessions/${encodeURIComponent(sessionId)}/adaptations/undo`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

export async function getWorkoutAdaptationHistory(sessionId: string): Promise<WorkoutAdaptation[]> {
  return readJson<WorkoutAdaptation[]>(
    await apiFetch(`/workout-plan/sessions/${encodeURIComponent(sessionId)}/adaptations`),
  );
}

export async function updateWorkoutSessionSet(
  sessionId: string,
  exerciseId: string,
  setIndex: number,
  body: WorkoutSessionSetPatch,
): Promise<WorkoutSession> {
  return readJson<WorkoutSession>(
    await apiFetch(
      `/workout-plan/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exerciseId)}/sets/${setIndex}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    ),
  );
}

export async function skipWorkoutSessionExercise(
  sessionId: string,
  exerciseId: string,
): Promise<WorkoutSession> {
  return readJson<WorkoutSession>(
    await apiFetch(
      `/workout-plan/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exerciseId)}/skip`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  );
}

export async function unskipWorkoutSessionExercise(
  sessionId: string,
  exerciseId: string,
): Promise<WorkoutSession> {
  return readJson<WorkoutSession>(
    await apiFetch(
      `/workout-plan/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exerciseId)}/unskip`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  );
}

export class WorkoutSessionIncompleteError extends ApiError {
  readonly incompleteExercises: number;
  readonly completedExercises: number;
  readonly skippedExercises: number;
  readonly totalExercises: number;

  constructor(payload: {
    incompleteExercises: number;
    completedExercises: number;
    skippedExercises: number;
    totalExercises: number;
  }) {
    super(409, 'WORKOUT_SESSION_INCOMPLETE');
    this.name = 'WorkoutSessionIncompleteError';
    this.incompleteExercises = payload.incompleteExercises;
    this.completedExercises = payload.completedExercises;
    this.skippedExercises = payload.skippedExercises;
    this.totalExercises = payload.totalExercises;
  }
}

export async function completeWorkoutSession(
  sessionId: string,
  body?: { confirmIncomplete?: boolean },
): Promise<WorkoutSession> {
  const response = await apiFetch(
    `/workout-plan/sessions/${encodeURIComponent(sessionId)}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ confirmIncomplete: body?.confirmIncomplete === true }),
    },
  );
  if (response.status === 409) {
    const payload = await readErrorPayload(response);
    if ((payload.code ?? payload.message) === 'WORKOUT_SESSION_INCOMPLETE') {
      throw new WorkoutSessionIncompleteError({
        incompleteExercises: Number(payload.incompleteExercises ?? 0),
        completedExercises: Number(payload.completedExercises ?? 0),
        skippedExercises: Number(payload.skippedExercises ?? 0),
        totalExercises: Number(payload.totalExercises ?? 0),
      });
    }
    throw new ApiError(409, payload.code ?? payload.message ?? 'CONFLICT');
  }
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new ApiError(response.status, payload.code ?? 'WORKOUT_SESSION_COMPLETE_FAILED');
  }
  return response.json() as Promise<WorkoutSession>;
}

export async function abandonWorkoutSession(sessionId: string): Promise<WorkoutSession> {
  return readJson<WorkoutSession>(
    await apiFetch(`/workout-plan/sessions/${encodeURIComponent(sessionId)}/abandon`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  );
}
