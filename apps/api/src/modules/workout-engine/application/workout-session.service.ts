import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { WorkoutPlanDayExercise } from '../domain/workout-engine.types';
import {
  WorkoutActiveSessionConflictError,
  WorkoutSessionIncompleteError,
  type WorkoutSessionCompleteInput,
  type WorkoutSessionSetPatch,
  type WorkoutSessionStartInput,
  type WorkoutSessionView,
} from '../domain/workout-session.types';
import { WorkoutEngineService } from './workout-engine.service';
import {
  WorkoutSessionRepository,
  type SessionExerciseSeed,
} from '../infrastructure/workout-session.repository';
import { WorkoutCatalogReleaseService } from '../catalog/workout-catalog-release.service';
import { WorkoutEnergyService } from '../energy/workout-energy.service';
import { ExerciseEnergyTimingProfileRepository } from '../energy/exercise-energy-timing-profile.repository';
import { buildPlannedExerciseEnergySnapshot } from '../energy/workout-session-energy-snapshot';
import type {
  ExerciseEnergyProfileRecord,
  ExerciseEnergyTimingProfileRecord,
  ResolveWeightResult,
} from '../energy/workout-energy.types';
import type { PrescriptionMode } from '../energy/workout-plan-prescription';
import { exactTargetReps } from '../energy/workout-plan-prescription';

/** Advisory lock namespace for workout session start. */
const WORKOUT_SESSION_LOCK_KEY = 209_010_01;

/** Documented validation bounds for session actuals. */
export const WORKOUT_SESSION_MAX_REPS = 500;
export const WORKOUT_SESSION_MAX_DURATION_SECONDS = 3 * 60 * 60;
export const WORKOUT_SESSION_MAX_WEIGHT_KG = 500;
export const WORKOUT_SESSION_WEIGHT_DECIMAL_PLACES = 2;

@Injectable()
export class WorkoutSessionService {
  constructor(
    @Inject(WorkoutSessionRepository) private readonly sessions: WorkoutSessionRepository,
    @Inject(WorkoutEngineService) private readonly workoutEngine: WorkoutEngineService,
    @Optional() @Inject(PrismaService) private readonly db?: PrismaService,
    @Optional()
    @Inject(WorkoutCatalogReleaseService)
    private readonly catalogReleases?: WorkoutCatalogReleaseService,
    @Optional()
    @Inject(WorkoutEnergyService)
    private readonly workoutEnergy?: WorkoutEnergyService,
    @Optional()
    @Inject(ExerciseEnergyTimingProfileRepository)
    private readonly timingProfiles?: ExerciseEnergyTimingProfileRepository,
  ) {}

  async getActive(userId: string): Promise<WorkoutSessionView | null> {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    return this.sessions.findActiveByUserId(userId);
  }

  /** Additive hub read: latest session for a calendar date (no schema change). */
  async getLatestForEffectiveDate(
    userId: string,
    effectiveDate: string,
  ): Promise<WorkoutSessionView | null> {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('WORKOUT_DATE_INVALID');
    return this.sessions.findLatestByUserAndEffectiveDate(userId, effectiveDate);
  }

  async getById(userId: string, sessionId: string): Promise<WorkoutSessionView> {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    const session = await this.sessions.findByIdForUser(userId, sessionId);
    if (!session) throw new Error('WORKOUT_SESSION_NOT_FOUND');
    return session;
  }

  async start(userId: string, input: WorkoutSessionStartInput = {}): Promise<WorkoutSessionView> {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');

    const run = async () => {
      const today = await this.workoutEngine.getTodayView(userId, input.date);
      const dayIndex =
        input.dayIndex == null ? today.dayIndex : Number(input.dayIndex);
      if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
        throw new Error('WORKOUT_DATE_INVALID');
      }

      const active = await this.sessions.findActiveByUserId(userId);
      if (active) {
        if (active.effectiveDayIndex === dayIndex && active.workoutPlanId === (today.planId ?? null)) {
          return active;
        }
        throw new WorkoutActiveSessionConflictError(active.id);
      }

      const day = today.days.find((item) => item.dayIndex === dayIndex) ?? null;
      if (!day) throw new Error('WORKOUT_DAY_NOT_FOUND');
      if (day.isRestDay || day.exercises.length === 0) throw new Error('WORKOUT_DAY_IS_REST');
      if (!today.planId) throw new Error('WORKOUT_PLAN_NOT_FOUND');

      const effectiveDate = input.date
        ? input.date.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('WORKOUT_DATE_INVALID');

      const sourceDayIndex =
        day.sourceDayIndex == null ? dayIndex : Number(day.sourceDayIndex);
      if (!Number.isInteger(sourceDayIndex) || sourceDayIndex < 0 || sourceDayIndex > 6) {
        throw new Error('WORKOUT_DATE_INVALID');
      }

      const sessionStartedAt = new Date();
      const weightResult = this.workoutEnergy
        ? await this.workoutEnergy.resolveWeight(userId, sessionStartedAt)
        : {
            status: 'UNAVAILABLE_MISSING_WEIGHT' as const,
            weightKg: null,
            source: null,
            sourceRecordedAt: null,
            asOf: sessionStartedAt.toISOString(),
          };
      const seeds = await this.buildExerciseSeeds(
        day.exercises,
        weightResult,
        sessionStartedAt,
      );
      try {
        return await this.sessions.createSnapshotSession({
          userId,
          workoutPlanId: today.planId,
          sourceDayIndex,
          effectiveDayIndex: dayIndex,
          effectiveDate,
          dayTitle: day.dayTitle ?? null,
          estimatedMinutes: day.estimatedMinutes ?? null,
          exercises: seeds,
          startedAt: sessionStartedAt,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const existing = await this.sessions.findActiveByUserId(userId);
          if (existing) {
            if (
              existing.effectiveDayIndex === dayIndex &&
              existing.workoutPlanId === today.planId
            ) {
              return existing;
            }
            throw new WorkoutActiveSessionConflictError(existing.id);
          }
        }
        throw error;
      }
    };

    if (!this.db) return run();
    const locked = await this.db.withSessionAdvisoryLock(
      WORKOUT_SESSION_LOCK_KEY,
      `workout-session-start:${userId}`,
      run,
    );
    if (!locked.acquired) throw new Error('WORKOUT_SESSION_START_IN_PROGRESS');
    return locked.result;
  }

  async updateSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setIndex: number,
    patch: WorkoutSessionSetPatch,
  ): Promise<WorkoutSessionView> {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    validateSetPatch(patch);
    if (!Number.isInteger(setIndex) || setIndex < 1 || setIndex > 20) {
      throw new Error('WORKOUT_SESSION_SET_NOT_FOUND');
    }
    return this.sessions.updateSet(userId, sessionId, exerciseId, setIndex, patch);
  }

  async skipExercise(userId: string, sessionId: string, exerciseId: string) {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    return this.sessions.skipExercise(userId, sessionId, exerciseId);
  }

  async unskipExercise(userId: string, sessionId: string, exerciseId: string) {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    return this.sessions.unskipExercise(userId, sessionId, exerciseId);
  }

  async complete(
    userId: string,
    sessionId: string,
    input: WorkoutSessionCompleteInput = {},
  ): Promise<WorkoutSessionView> {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    const session = await this.sessions.findByIdForUser(userId, sessionId);
    if (!session) throw new Error('WORKOUT_SESSION_NOT_FOUND');
    if (session.status === 'COMPLETED') return session;
    if (session.status === 'ABANDONED') throw new Error('WORKOUT_SESSION_ABANDONED');

    const completedExercises = session.exercises.filter((item) => item.status === 'COMPLETED').length;
    const skippedExercises = session.exercises.filter((item) => item.status === 'SKIPPED').length;
    const incompleteExercises = session.exercises.filter(
      (item) => item.status !== 'COMPLETED' && item.status !== 'SKIPPED',
    ).length;

    if (incompleteExercises > 0 && input.confirmIncomplete !== true) {
      throw new WorkoutSessionIncompleteError({
        incompleteExercises,
        completedExercises,
        skippedExercises,
        totalExercises: session.totalExercises,
      });
    }

    return this.sessions.complete(userId, sessionId);
  }

  async abandon(userId: string, sessionId: string) {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    return this.sessions.abandon(userId, sessionId);
  }

  private async buildExerciseSeeds(
    exercises: WorkoutPlanDayExercise[],
    weightResult: ResolveWeightResult,
    sessionStartedAt: Date,
  ): Promise<SessionExerciseSeed[]> {
    const seeds: SessionExerciseSeed[] = [];
    for (const [index, exercise] of exercises.entries()) {
      const key = exercise.exerciseKey ?? exercise.exerciseName;
      if (!this.catalogReleases) {
        throw new Error('WORKOUT_CATALOG_RELEASE_SERVICE_UNAVAILABLE');
      }
      const detail = await this.catalogReleases.getPublishedExerciseDetail(key);
      const targetSets = Math.max(1, Math.min(20, Number(exercise.sets ?? 1) || 1));
      const displayNameRu = String(detail['displayNameRu'] ?? detail['nameRu'] ?? key);
      const displayNameEn = String(detail['displayNameEn'] ?? detail['nameEn'] ?? key);
      // easierVariantRu is revision guidance text — never substitute a related exercise name.
      const easierVariantRu =
        detail['easierVariantRu'] == null ? null : String(detail['easierVariantRu']);
      const easierVariantEn =
        detail['easierVariantEn'] == null ? null : String(detail['easierVariantEn']);
      const mediaRows = Array.isArray(detail['media']) ? (detail['media'] as unknown[]) : [];
      const media = mediaRows.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          id: String(row.id ?? ''),
          mediaType: String(row.mediaType ?? 'image'),
          role: String(row.role ?? 'cover'),
          locale: row.locale == null ? null : String(row.locale),
          altText: String(row.altText ?? displayNameRu),
          sortOrder: Number(row.sortOrder ?? 0),
        };
      });
      const exerciseRevisionId =
        detail['exerciseRevisionId'] == null ? null : String(detail['exerciseRevisionId']);
      const prescriptionMode = (exercise.prescriptionMode ?? null) as PrescriptionMode | null;
      const targetRepsMin =
        prescriptionMode === 'DURATION' ? null : exercise.repsMin ?? null;
      const targetRepsMax =
        prescriptionMode === 'DURATION' ? null : exercise.repsMax ?? null;
      const targetDurationSeconds =
        prescriptionMode === 'DURATION' ? exercise.durationSecondsPerSet ?? null : null;

      let energyProfile: ExerciseEnergyProfileRecord | { status: 'INVALID_ENERGY_PROFILE' } | null =
        null;
      let timingProfile:
        | ExerciseEnergyTimingProfileRecord
        | { status: 'AMBIGUOUS_TIMING_PROFILE' }
        | null = null;
      if (exerciseRevisionId && this.workoutEnergy) {
        try {
          energyProfile = await this.workoutEnergy.resolveApprovedProfile(exerciseRevisionId);
        } catch (error) {
          if (errorMessage(error) !== 'INVALID_ENERGY_PROFILE') throw error;
          energyProfile = { status: 'INVALID_ENERGY_PROFILE' };
        }
        if (prescriptionMode === 'REPS' && this.timingProfiles) {
          try {
            timingProfile = await this.timingProfiles.resolveApproved(exerciseRevisionId);
          } catch (error) {
            if (errorMessage(error) !== 'AMBIGUOUS_TIMING_PROFILE') throw error;
            timingProfile = { status: 'AMBIGUOUS_TIMING_PROFILE' };
          }
        }
      }
      const setTargets = Array.from({ length: targetSets }, () => ({
        targetReps: exactTargetReps(targetRepsMin, targetRepsMax),
        targetDurationSeconds,
      }));
      const energySnapshot = buildPlannedExerciseEnergySnapshot({
        prescriptionMode,
        setTargets,
        weightResult,
        energyProfile,
        timingProfile,
        sessionStartedAt,
        estimateExerciseEnergy: (input) => {
          if (!this.workoutEnergy) throw new Error('WORKOUT_ENERGY_SERVICE_UNAVAILABLE');
          return this.workoutEnergy.estimateExerciseEnergy(input);
        },
      });

      seeds.push({
        sourceExerciseId:
          exercise.exerciseId ?? (detail['id'] == null ? null : String(detail['id'])),
        exerciseRevisionId,
        catalogReleaseId:
          detail['catalogReleaseId'] == null ? null : String(detail['catalogReleaseId']),
        sourcePlanDayRowId: exercise.planDayRowId ?? null,
        exerciseKey: key,
        orderIndex: exercise.exerciseOrder ?? index,
        displayNameRu,
        displayNameEn,
        targetSets,
        targetRepsMin,
        targetRepsMax,
        targetDurationSeconds,
        restSeconds: exercise.restSeconds ?? 60,
        techniqueSummaryRu:
          detail['techniqueSummaryRu'] == null ? null : String(detail['techniqueSummaryRu']),
        techniqueSummaryEn:
          detail['techniqueSummaryEn'] == null ? null : String(detail['techniqueSummaryEn']),
        commonMistakeRu:
          detail['commonMistakeRu'] == null ? null : String(detail['commonMistakeRu']),
        commonMistakeEn:
          detail['commonMistakeEn'] == null ? null : String(detail['commonMistakeEn']),
        easierVariantRu,
        easierVariantEn,
        breathingRu: detail['breathingRu'] == null ? null : String(detail['breathingRu']),
        breathingEn: detail['breathingEn'] == null ? null : String(detail['breathingEn']),
        stopConditionsRu:
          detail['stopConditionsRu'] == null ? null : String(detail['stopConditionsRu']),
        stopConditionsEn:
          detail['stopConditionsEn'] == null ? null : String(detail['stopConditionsEn']),
        media,
        energySnapshot,
      });
    }
    return seeds;
  }
}

function validateSetPatch(patch: WorkoutSessionSetPatch): void {
  if (patch.actualReps !== undefined && patch.actualReps !== null) {
    const reps = patch.actualReps;
    if (
      typeof reps !== 'number' ||
      !Number.isFinite(reps) ||
      !Number.isInteger(reps) ||
      reps < 0 ||
      reps > WORKOUT_SESSION_MAX_REPS
    ) {
      throw new Error('WORKOUT_SESSION_ACTUAL_REPS_INVALID');
    }
  }
  if (patch.actualDurationSeconds !== undefined && patch.actualDurationSeconds !== null) {
    const duration = patch.actualDurationSeconds;
    if (
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      !Number.isInteger(duration) ||
      duration < 0 ||
      duration > WORKOUT_SESSION_MAX_DURATION_SECONDS
    ) {
      throw new Error('WORKOUT_SESSION_ACTUAL_DURATION_INVALID');
    }
  }
  if (patch.weightKg !== undefined && patch.weightKg !== null) {
    const weight = patch.weightKg;
    if (
      typeof weight !== 'number' ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > WORKOUT_SESSION_MAX_WEIGHT_KG ||
      !hasMaxDecimalPlaces(weight, WORKOUT_SESSION_WEIGHT_DECIMAL_PLACES)
    ) {
      throw new Error('WORKOUT_SESSION_WEIGHT_INVALID');
    }
  }
}

function hasMaxDecimalPlaces(value: number, maxPlaces: number): boolean {
  const scaled = value * 10 ** maxPlaces;
  return Math.abs(scaled - Math.round(scaled)) < 1e-8;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23505') return true;
  const message = String((err as { message?: string } | null)?.message ?? err ?? '');
  return /duplicate key value violates unique constraint/i.test(message);
}

function errorMessage(error: unknown): string {
  return String((error as { message?: string } | null)?.message ?? error ?? '');
}
