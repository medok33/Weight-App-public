import { describe, expect, it } from 'vitest';
import { WorkoutSessionService } from '../application/workout-session.service';
import {
  WorkoutActiveSessionConflictError,
  WorkoutSessionIncompleteError,
} from '../domain/workout-session.types';
import type {
  WorkoutSessionSetPatch,
  WorkoutSessionView,
} from '../domain/workout-session.types';
import type { SessionExerciseSeed } from '../infrastructure/workout-session.repository';

type MemorySession = WorkoutSessionView;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemorySessionRepository {
  sessions: MemorySession[] = [];

  async findActiveByUserId(userId: string) {
    return this.sessions.find((s) => s.userId === userId && s.status === 'ACTIVE') ?? null;
  }

  async findByIdForUser(userId: string, sessionId: string) {
    return this.sessions.find((s) => s.userId === userId && s.id === sessionId) ?? null;
  }

  async createSnapshotSession(input: {
    userId: string;
    workoutPlanId: string;
    sourceDayIndex: number;
    effectiveDayIndex: number;
    effectiveDate: string;
    dayTitle: string | null;
    estimatedMinutes: number | null;
    exercises: SessionExerciseSeed[];
    startedAt?: Date;
  }) {
    if (this.sessions.some((s) => s.userId === input.userId && s.status === 'ACTIVE')) {
      const err = Object.assign(new Error('duplicate key'), { code: '23505' });
      throw err;
    }
    const now = (input.startedAt ?? new Date()).toISOString();
    const session: MemorySession = {
      id: `sess-${this.sessions.length + 1}`,
      userId: input.userId,
      workoutPlanId: input.workoutPlanId,
      sourceDayIndex: input.sourceDayIndex,
      effectiveDayIndex: input.effectiveDayIndex,
      effectiveDate: input.effectiveDate,
      dayTitle: input.dayTitle,
      estimatedMinutes: input.estimatedMinutes,
      status: 'ACTIVE',
      startedAt: now,
      lastActivityAt: now,
      completedAt: null,
      abandonedAt: null,
      durationSeconds: null,
      totalExercises: input.exercises.length,
      completedExercises: 0,
      version: 1,
      exercises: input.exercises.map((exercise) => ({
        id: `ex-${input.userId}-${exercise.orderIndex}`,
        orderIndex: exercise.orderIndex,
        exerciseKey: exercise.exerciseKey,
        sourceExerciseId: exercise.sourceExerciseId,
        exerciseRevisionId: exercise.exerciseRevisionId ?? null,
        catalogReleaseId: exercise.catalogReleaseId ?? null,
        displayNameRu: exercise.displayNameRu,
        displayNameEn: exercise.displayNameEn,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
        targetDurationSeconds: exercise.targetDurationSeconds,
        restSeconds: exercise.restSeconds,
        techniqueSummaryRu: exercise.techniqueSummaryRu,
        techniqueSummaryEn: exercise.techniqueSummaryEn,
        commonMistakeRu: exercise.commonMistakeRu,
        commonMistakeEn: exercise.commonMistakeEn,
        easierVariantRu: exercise.easierVariantRu,
        easierVariantEn: exercise.easierVariantEn,
        breathingRu: exercise.breathingRu ?? null,
        breathingEn: exercise.breathingEn ?? null,
        stopConditionsRu: exercise.stopConditionsRu ?? null,
        stopConditionsEn: exercise.stopConditionsEn ?? null,
        media: exercise.media,
        status: 'PENDING',
        skippedAt: null,
        completedAt: null,
        sets: Array.from({ length: exercise.targetSets }, (_, i) => ({
          id: `set-${input.userId}-${exercise.orderIndex}-${i + 1}`,
          setIndex: i + 1,
          targetReps: exercise.targetRepsMax ?? exercise.targetRepsMin,
          targetDurationSeconds: exercise.targetDurationSeconds,
          actualReps: null,
          actualDurationSeconds: null,
          weightKg: null,
          completedAt: null,
        })),
      })),
    };
    this.sessions.push(session);
    return clone(session);
  }

  async updateSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setIndex: number,
    patch: WorkoutSessionSetPatch,
  ) {
    const session = this.requireActive(userId, sessionId);
    const exercise = session.exercises.find((item) => item.id === exerciseId);
    if (!exercise) throw new Error('WORKOUT_SESSION_EXERCISE_NOT_FOUND');
    if (exercise.status === 'SKIPPED') throw new Error('WORKOUT_EXERCISE_SKIPPED');
    const set = exercise.sets.find((item) => item.setIndex === setIndex);
    if (!set) throw new Error('WORKOUT_SESSION_SET_NOT_FOUND');
    if (patch.actualReps !== undefined) set.actualReps = patch.actualReps;
    if (patch.actualDurationSeconds !== undefined) set.actualDurationSeconds = patch.actualDurationSeconds;
    if (patch.weightKg !== undefined) set.weightKg = patch.weightKg;
    if (patch.completed === true) set.completedAt = set.completedAt ?? new Date().toISOString();
    if (patch.completed === false) set.completedAt = null;
    if (exercise.status !== 'SKIPPED') {
      const allDone = exercise.sets.every((item) => item.completedAt != null);
      const anyDone = exercise.sets.some((item) => item.completedAt != null);
      exercise.status = allDone ? 'COMPLETED' : anyDone ? 'IN_PROGRESS' : 'PENDING';
      exercise.completedAt = allDone ? exercise.completedAt ?? new Date().toISOString() : null;
    }
    session.completedExercises = session.exercises.filter((item) =>
      item.status === 'COMPLETED' || item.status === 'SKIPPED').length;
    session.lastActivityAt = new Date().toISOString();
    return clone(session);
  }

  async skipExercise(userId: string, sessionId: string, exerciseId: string) {
    const session = this.requireActive(userId, sessionId);
    const exercise = session.exercises.find((item) => item.id === exerciseId);
    if (!exercise) throw new Error('WORKOUT_SESSION_EXERCISE_NOT_FOUND');
    exercise.status = 'SKIPPED';
    exercise.skippedAt = exercise.skippedAt ?? new Date().toISOString();
    exercise.completedAt = null;
    session.completedExercises = session.exercises.filter((item) =>
      item.status === 'COMPLETED' || item.status === 'SKIPPED').length;
    return clone(session);
  }

  async unskipExercise(userId: string, sessionId: string, exerciseId: string) {
    const session = this.requireActive(userId, sessionId);
    const exercise = session.exercises.find((item) => item.id === exerciseId);
    if (!exercise) throw new Error('WORKOUT_SESSION_EXERCISE_NOT_FOUND');
    exercise.status = 'PENDING';
    exercise.skippedAt = null;
    exercise.completedAt = null;
    const allDone = exercise.sets.every((item) => item.completedAt != null);
    const anyDone = exercise.sets.some((item) => item.completedAt != null);
    exercise.status = allDone ? 'COMPLETED' : anyDone ? 'IN_PROGRESS' : 'PENDING';
    session.completedExercises = session.exercises.filter((item) =>
      item.status === 'COMPLETED' || item.status === 'SKIPPED').length;
    return clone(session);
  }

  async complete(userId: string, sessionId: string) {
    const session = this.requireOwned(userId, sessionId);
    if (session.status === 'ABANDONED') throw new Error('WORKOUT_SESSION_ABANDONED');
    if (session.status === 'COMPLETED') return clone(session);
    session.status = 'COMPLETED';
    session.completedAt = new Date().toISOString();
    session.durationSeconds = 120;
    session.completedExercises = session.exercises.filter((item) =>
      item.status === 'COMPLETED' || item.status === 'SKIPPED').length;
    return clone(session);
  }

  async abandon(userId: string, sessionId: string) {
    const session = this.requireOwned(userId, sessionId);
    if (session.status === 'COMPLETED') throw new Error('WORKOUT_SESSION_COMPLETED');
    if (session.status === 'ABANDONED') return clone(session);
    session.status = 'ABANDONED';
    session.abandonedAt = new Date().toISOString();
    session.durationSeconds = 90;
    return clone(session);
  }

  private requireOwned(userId: string, sessionId: string) {
    const session = this.sessions.find((s) => s.userId === userId && s.id === sessionId);
    if (!session) throw new Error('WORKOUT_SESSION_NOT_FOUND');
    return session;
  }

  private requireActive(userId: string, sessionId: string) {
    const session = this.requireOwned(userId, sessionId);
    if (session.status === 'COMPLETED') throw new Error('WORKOUT_SESSION_COMPLETED');
    if (session.status === 'ABANDONED') throw new Error('WORKOUT_SESSION_ABANDONED');
    return session;
  }
}

class FakeWorkoutEngine {
  planId = 'plan-1';
  dayIndex = 0;
  day = {
    dayIndex: 0,
    dayTitle: 'Сила',
    isRestDay: false,
    estimatedMinutes: 30,
    exercises: [
      {
        exerciseOrder: 0,
        exerciseName: 'bodyweight_squats',
        exerciseKey: 'bodyweight_squats',
        exerciseId: 'e1',
        riskLevel: 'low' as const,
        sets: 2,
        repsMin: 10,
        repsMax: 12,
        restSeconds: 60,
      },
      {
        exerciseOrder: 1,
        exerciseName: 'push_ups',
        exerciseKey: 'push_ups',
        exerciseId: 'e2',
        riskLevel: 'low' as const,
        sets: 1,
        repsMin: 8,
        repsMax: 8,
        restSeconds: 45,
      },
    ],
  };

  async getTodayView(userId: string, date?: string) {
    void userId;
    void date;
    return {
      userId,
      version: 1,
      planId: this.planId,
      dayIndex: this.dayIndex,
      day: this.day,
      days: [this.day],
    };
  }
}

class FakeCatalog {
  async getPublishedExerciseDetail(key: string) {
    return {
      id: key === 'push_ups' ? 'e2' : 'e1',
      key,
      name: key,
      displayNameRu: key === 'push_ups' ? 'Отжимания' : 'Приседания',
      displayNameEn: key === 'push_ups' ? 'Push-ups' : 'Squats',
      techniqueSummaryRu: 'Техника',
      techniqueSummaryEn: 'Technique',
      commonMistakeRu: 'Ошибка',
      commonMistakeEn: 'Mistake',
      easierVariantRu: 'Сократите амплитуду и сохраняйте опору.',
      easierVariantEn: 'Reduce range and keep support.',
      breathingRu: 'Выдыхайте на усилии.',
      breathingEn: 'Exhale on effort.',
      stopConditionsRu: 'Остановитесь при острой боли или головокружении.',
      stopConditionsEn: 'Stop on sharp pain or dizziness.',
      easierVariantKey: null,
      exerciseRevisionId: key === 'push_ups' ? 'rev-2' : 'rev-1',
      media: [],
    };
  }
}

class FakeWorkoutEnergy {
  resolveWeightCalls = 0;

  async resolveWeight(_userId: string, asOf: Date) {
    this.resolveWeightCalls += 1;
    return {
      status: 'AVAILABLE' as const,
      weightKg: 80,
      source: 'PROFILE_FALLBACK' as const,
      sourceRecordedAt: null,
      asOf: asOf.toISOString(),
    };
  }

  async resolveApprovedProfile() {
    return null;
  }

  estimateExerciseEnergy() {
    throw new Error('estimate should not run without an energy profile');
  }
}

class FakeTimingProfiles {
  async resolveApproved() {
    return null;
  }
}

function createService() {
  const repo = new MemorySessionRepository();
  const engine = new FakeWorkoutEngine();
  const catalog = new FakeCatalog();
  const workoutEnergy = new FakeWorkoutEnergy();
  const service = new WorkoutSessionService(
    repo as never,
    engine as never,
    undefined,
    catalog as never,
    workoutEnergy as never,
    new FakeTimingProfiles() as never,
  );
  return { service, repo, engine, workoutEnergy };
}

describe('WORKOUT-V2-01C workout session service', () => {
  it('01C start session creates snapshot', async () => {
    const { service } = createService();
    const session = await service.start('u1');
    expect(session.status).toBe('ACTIVE');
    expect(session.totalExercises).toBe(2);
    expect(session.exercises[0]?.displayNameRu).toBe('Приседания');
    expect(session.exercises[0]?.sets.length).toBe(2);
    expect(session.exercises[0]?.techniqueSummaryRu).toBe('Техника');
    expect(session.exercises[0]?.easierVariantRu).toBe(
      'Сократите амплитуду и сохраняйте опору.',
    );
    expect(session.exercises[0]?.breathingRu).toBe('Выдыхайте на усилии.');
    expect(session.exercises[0]?.stopConditionsRu).toMatch(/Остановитесь/);
  });

  it('01B seeds duration prescriptions without rep targets', async () => {
    const { service, engine } = createService();
    engine.day.exercises = [
      {
        ...engine.day.exercises[0]!,
        prescriptionMode: 'DURATION',
        durationSecondsPerSet: 45,
      },
    ] as never;
    const session = await service.start('u1');
    expect(session.exercises[0]?.targetRepsMin).toBeNull();
    expect(session.exercises[0]?.targetRepsMax).toBeNull();
    expect(session.exercises[0]?.targetDurationSeconds).toBe(45);
    expect(session.exercises[0]?.sets[0]?.targetReps).toBeNull();
    expect(session.exercises[0]?.sets[0]?.targetDurationSeconds).toBe(45);
  });

  it('01C repeated start is idempotent', async () => {
    const { service, workoutEnergy } = createService();
    const first = await service.start('u1');
    const second = await service.start('u1');
    expect(first.id).toBe(second.id);
    expect(workoutEnergy.resolveWeightCalls).toBe(1);
  });

  it('01C parallel-style second start of other day conflicts', async () => {
    const { service, engine } = createService();
    await service.start('u1');
    engine.dayIndex = 2;
    engine.day = { ...engine.day, dayIndex: 2 };
    await expect(service.start('u1', { dayIndex: 2 })).rejects.toBeInstanceOf(
      WorkoutActiveSessionConflictError,
    );
    try {
      await service.start('u1', { dayIndex: 2 });
    } catch (err) {
      expect(err).toBeInstanceOf(WorkoutActiveSessionConflictError);
      expect((err as WorkoutActiveSessionConflictError).message).toBe(
        'WORKOUT_ACTIVE_SESSION_EXISTS',
      );
      expect((err as WorkoutActiveSessionConflictError).activeSessionId).toBeTruthy();
    }
  });

  it('01C users are isolated', async () => {
    const { service } = createService();
    const a = await service.start('u1');
    const b = await service.start('u2');
    expect(a.id).not.toBe(b.id);
    await expect(service.getById('u2', a.id)).rejects.toThrow(/WORKOUT_SESSION_NOT_FOUND/);
  });

  it('01C update set, idempotent complete, and auto exercise COMPLETED', async () => {
    const { service } = createService();
    const session = await service.start('u1');
    const exercise = session.exercises[0]!;
    let updated = await service.updateSet(session.userId, session.id, exercise.id, 1, {
      completed: true,
      actualReps: 10,
    });
    expect(updated.exercises[0]?.status).toBe('IN_PROGRESS');
    updated = await service.updateSet(session.userId, session.id, exercise.id, 1, {
      completed: true,
      actualReps: 10,
    });
    expect(updated.exercises[0]?.sets[0]?.actualReps).toBe(10);
    updated = await service.updateSet(session.userId, session.id, exercise.id, 2, {
      completed: true,
      actualReps: 12,
    });
    expect(updated.exercises[0]?.status).toBe('COMPLETED');
    expect(updated.completedExercises).toBe(1);
  });

  it('01C clear completed set reopens exercise', async () => {
    const { service } = createService();
    const session = await service.start('u1');
    const exercise = session.exercises[0]!;
    await service.updateSet(session.userId, session.id, exercise.id, 1, { completed: true });
    await service.updateSet(session.userId, session.id, exercise.id, 2, { completed: true });
    const cleared = await service.updateSet(session.userId, session.id, exercise.id, 2, {
      completed: false,
    });
    expect(cleared.exercises[0]?.status).toBe('IN_PROGRESS');
    expect(cleared.exercises[0]?.completedAt).toBe(null);
  });

  it('01C skip and unskip', async () => {
    const { service } = createService();
    const session = await service.start('u1');
    const exercise = session.exercises[1]!;
    let updated = await service.skipExercise(session.userId, session.id, exercise.id);
    expect(updated.exercises[1]?.status).toBe('SKIPPED');
    expect(updated.completedExercises).toBe(1);
    const setsBefore = updated.exercises[1]?.sets.map((set) => set.completedAt);
    updated = await service.unskipExercise(session.userId, session.id, exercise.id);
    expect(updated.exercises[1]?.status).toBe('PENDING');
    expect(updated.completedExercises).toBe(0);
    expect(updated.exercises[1]?.sets.map((set) => set.completedAt)).toEqual(setsBefore);
  });

  it('01C complete and abandon are idempotent; terminal mutations blocked', async () => {
    const { service } = createService();
    const session = await service.start('u1');
    await expect(service.complete(session.userId, session.id)).rejects.toBeInstanceOf(
      WorkoutSessionIncompleteError,
    );
    for (const exercise of session.exercises) {
      await service.skipExercise(session.userId, session.id, exercise.id);
    }
    const completed = await service.complete(session.userId, session.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.durationSeconds).toBe(120);
    const again = await service.complete(session.userId, session.id);
    expect(again.id).toBe(completed.id);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        completed: true,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_COMPLETED/);

    const other = await service.start('u3');
    const abandoned = await service.abandon(other.userId, other.id);
    expect(abandoned.status).toBe('ABANDONED');
    const abandonedAgain = await service.abandon(other.userId, other.id);
    expect(abandonedAgain.status).toBe('ABANDONED');
    await expect(
      service.updateSet(other.userId, other.id, other.exercises[0]!.id, 1, { completed: true }),
    ).rejects.toThrow(/WORKOUT_SESSION_ABANDONED/);
  });

  it('01C incomplete complete requires confirmIncomplete', async () => {
    const { service } = createService();
    const session = await service.start('u1');
    await expect(service.complete(session.userId, session.id)).rejects.toBeInstanceOf(
      WorkoutSessionIncompleteError,
    );
    await expect(
      service.complete(session.userId, session.id, { confirmIncomplete: false }),
    ).rejects.toMatchObject({
      message: 'WORKOUT_SESSION_INCOMPLETE',
      incompleteExercises: 2,
    });
    const completed = await service.complete(session.userId, session.id, {
      confirmIncomplete: true,
    });
    expect(completed.status).toBe('COMPLETED');
  });

  it('01C skipped exercise rejects set mutation until unskip', async () => {
    const { service } = createService();
    const session = await service.start('u1');
    const exercise = session.exercises[1]!;
    await service.updateSet(session.userId, session.id, exercise.id, 1, {
      completed: true,
      actualReps: 8,
    });
    await service.skipExercise(session.userId, session.id, exercise.id);
    await expect(
      service.updateSet(session.userId, session.id, exercise.id, 1, { completed: false }),
    ).rejects.toThrow(/WORKOUT_EXERCISE_SKIPPED/);
    const restored = await service.unskipExercise(session.userId, session.id, exercise.id);
    expect(restored.exercises[1]?.sets[0]?.actualReps).toBe(8);
    const cleared = await service.updateSet(session.userId, session.id, exercise.id, 1, {
      completed: false,
    });
    expect(cleared.exercises[1]?.sets[0]?.completedAt).toBe(null);
  });

  it('01C invalid set index and actual values', async () => {
    const { service } = createService();
    const session = await service.start('u1');
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 99, {
        completed: true,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_SET_NOT_FOUND/);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        actualReps: -1,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_ACTUAL_REPS_INVALID/);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        actualReps: 0,
      }),
    ).resolves.toBeTruthy();
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        actualReps: 501,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_ACTUAL_REPS_INVALID/);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        actualDurationSeconds: -1,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_ACTUAL_DURATION_INVALID/);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        weightKg: -5,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_WEIGHT_INVALID/);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        weightKg: Number.NaN,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_WEIGHT_INVALID/);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        weightKg: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_WEIGHT_INVALID/);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        weightKg: 12.345,
      }),
    ).rejects.toThrow(/WORKOUT_SESSION_WEIGHT_INVALID/);
    await expect(
      service.updateSet(session.userId, session.id, session.exercises[0]!.id, 1, {
        weightKg: 12.34,
      }),
    ).resolves.toBeTruthy();
  });

  it('01C active retrieval and no client userId authority', async () => {
    const { service } = createService();
    expect(await service.getActive('u1')).toBe(null);
    const session = await service.start('u1');
    const active = await service.getActive('u1');
    expect(active?.id).toBe(session.id);
    await expect(service.start('')).rejects.toThrow(/WORKOUT_PLAN_USER_REQUIRED/);
  });
});
