import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { UserProfileService } from '../../user-profile/application/user-profile.service';
import type { TrainingLevel } from '../../user-profile/domain/user-profile.types';
import { buildWorkoutPlan, validateExercise } from '../domain/workout-engine.policy';
import { DEFAULT_EXERCISES, toWorkoutPlanSummary } from '../domain/workout-engine.mapper';
import {
  ALGORITHM_VERSION,
  WORKOUT_EQUIPMENT_CODES,
  filterCatalog,
} from '../domain/workout-plan-generator';
import {
  GENERATOR_CONTRACT_VERSION,
  generateWeeklyPlanForPilot,
  selectHomeShortReplacementForPilot,
  type WorkoutGeneratorDecisionTrace,
} from '../domain/workout-generator-pilot-contract';
import type {
  Exercise,
  WorkoutPlanDayDetail,
  WorkoutPlanDetail,
  WorkoutProfile,
  WorkoutProfilePatch,
  WorkoutReplacementType,
  WorkoutSetupStatus,
} from '../domain/workout-engine.types';
import { WorkoutCatalogReleaseService } from '../catalog/workout-catalog-release.service';
import { WorkoutEngineRepository } from '../infrastructure/workout-engine.repository';
import { WorkoutProfileRepository } from '../infrastructure/workout-profile.repository';

/** Advisory lock namespace for workout plan generation. */
const WORKOUT_GENERATE_LOCK_KEY = 207_010_01;

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23505') return true;
  const message = String((err as { message?: string } | null)?.message ?? err ?? '');
  return /duplicate key value violates unique constraint/i.test(message);
}

function asWorkoutEquipment(codes: string[] | null | undefined): string[] {
  if (!codes?.length) return [];
  const allowed = new Set<string>(WORKOUT_EQUIPMENT_CODES);
  return [
    ...new Set(
      codes
        .map((c) => String(c).trim().toUpperCase().replace(/-/g, '_'))
        .map((c) => c === 'BAND' ? 'RESISTANCE_BAND' : c)
        .filter((c) => allowed.has(c)),
    ),
  ];
}

@Injectable()
export class WorkoutEngineService {
  constructor(
    @Inject(WorkoutEngineRepository) private readonly repository: WorkoutEngineRepository,
    @Optional() @Inject(UserProfileService) private readonly userProfile?: UserProfileService,
    @Optional() @Inject(PrismaService) private readonly db?: PrismaService,
    @Optional()
    @Inject(WorkoutProfileRepository)
    private readonly workoutProfiles?: WorkoutProfileRepository,
    @Optional()
    @Inject(WorkoutCatalogReleaseService)
    private readonly catalogReleases?: WorkoutCatalogReleaseService,
  ) {}

  register(exercise: Exercise) {
    return validateExercise(exercise);
  }

  build(exercises: Exercise[], blockedTags: string[] = []) {
    return buildWorkoutPlan(exercises, blockedTags);
  }

  /** Find latest plan only — never auto-creates a fixture plan. */
  async getActivePlan(userId: string) {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    return this.repository.findLatestByUserId(userId);
  }

  async getSummary(userId: string) {
    return this.getEffectiveSummary(userId);
  }

  async getEffectiveSummary(userId: string) {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    const active = await this.repository.findLatestByUserId(userId);
    if (!active) {
      return toWorkoutPlanSummary(userId, 0, { days: [] });
    }
    const plan = await this.applyActiveOverrides(active.id, active.plan);
    return toWorkoutPlanSummary(userId, active.version, plan, active.id, {
      algorithmVersion: active.algorithmVersion,
      status: active.status,
    });
  }

  async getOrCreateWorkoutProfile(userId: string): Promise<WorkoutProfile> {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');
    const existing = await this.workoutProfiles?.findByUserId(userId);
    if (existing) return existing;

    let trainingLevel: TrainingLevel = 'BEGINNER';
    let workoutsPerWeek = 3;
    if (this.userProfile) {
      try {
        const legacy = await this.userProfile.getProfile(userId);
        if (legacy?.trainingLevel) trainingLevel = legacy.trainingLevel as TrainingLevel;
        if (legacy?.workoutsPerWeek && legacy.workoutsPerWeek >= 2 && legacy.workoutsPerWeek <= 5) {
          workoutsPerWeek = legacy.workoutsPerWeek;
        }
      } catch {
        // Defaults are intentionally safe; kitchen equipment is never copied.
      }
    }
    if (this.workoutProfiles) {
      return this.workoutProfiles.createDefaults(userId, { trainingLevel, workoutsPerWeek });
    }
    return {
      userId,
      trainingLevel,
      trainingPlace: 'HOME',
      workoutsPerWeek,
      preferredDuration: 'STANDARD',
      availableDays: [0, 2, 4],
      workoutEquipment: ['NONE', 'BODYWEIGHT'],
      preferredActivityTypes: ['strength', 'walking', 'mobility'],
      excludedExerciseKeys: [],
    };
  }

  async updateWorkoutProfile(userId: string, patch: WorkoutProfilePatch) {
    if (!this.workoutProfiles) throw new Error('WORKOUT_PROFILE_REPOSITORY_UNAVAILABLE');
    await this.getOrCreateWorkoutProfile(userId);
    return this.workoutProfiles.update(userId, validateProfilePatch(patch));
  }

  async getSetupStatus(userId: string): Promise<WorkoutSetupStatus> {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');

    let profile: WorkoutProfile | null = null;
    try {
      profile = await this.getOrCreateWorkoutProfile(userId);
    } catch {
      profile = null;
    }
    let trainingLevel: TrainingLevel | null = profile?.trainingLevel ?? null;
    let workoutsPerWeek: number | null = profile?.workoutsPerWeek ?? null;
    let goalKind: string | null = null;
    let equipmentCodes: string[] = profile?.workoutEquipment ?? [];

    if (this.userProfile) {
      try {
        const [profile, goal] = await Promise.all([
          this.userProfile.getProfile(userId),
          this.userProfile.getGoal(userId),
        ]);
        trainingLevel ??= (profile?.trainingLevel as TrainingLevel | null | undefined) ?? null;
        workoutsPerWeek ??= profile?.workoutsPerWeek ?? null;
        goalKind = goal?.kind ?? null;
        if (!equipmentCodes.length) {
          equipmentCodes = asWorkoutEquipment(profile?.equipmentCodes);
        }
      } catch {
        // Treat missing user/profile as incomplete setup.
      }
    }

    const missing: string[] = [];
    if (!trainingLevel) missing.push('trainingLevel');
    if (workoutsPerWeek == null || workoutsPerWeek < 2) missing.push('workoutsPerWeek');
    if (!goalKind?.trim()) missing.push('goalKind');

    return {
      ready: missing.length === 0,
      missing,
      trainingLevel,
      workoutsPerWeek,
      goalKind,
      equipmentCodes,
      profile,
    };
  }

  async generatePlan(userId: string, options?: { excludedKeys?: string[] }) {
    if (!userId) throw new Error('WORKOUT_PLAN_USER_REQUIRED');

    const run = async () => {
      const setup = await this.getSetupStatus(userId);
      if (!setup.ready || !setup.trainingLevel || !setup.goalKind || setup.workoutsPerWeek == null) {
        throw new Error('WORKOUT_SETUP_INCOMPLETE');
      }

      if (!this.catalogReleases) {
        throw new Error('WORKOUT_CATALOG_RELEASE_SERVICE_UNAVAILABLE');
      }
      const { release, exercises: catalog } =
        await this.catalogReleases.listGeneratorEligibleExercises();
      const workoutProfile = setup.profile ?? await this.getOrCreateWorkoutProfile(userId);
      const input = {
        goalKind: setup.goalKind,
        trainingLevel: setup.trainingLevel,
        trainingPlace: workoutProfile.trainingPlace,
        workoutsPerWeek: workoutProfile.workoutsPerWeek,
        preferredDuration: workoutProfile.preferredDuration,
        availableDays: workoutProfile.availableDays,
        equipmentCodes: workoutProfile.workoutEquipment,
        preferredActivityTypes: workoutProfile.preferredActivityTypes,
        excludedKeys: [
          ...new Set([...workoutProfile.excludedExerciseKeys, ...(options?.excludedKeys ?? [])]),
        ],
      };
      const generated = generateWeeklyPlanForPilot(catalog, input, {
        id: release.id,
        code: release.code,
        manifestVersion: release.manifestVersion,
      });
      if (generated.status === 'INSUFFICIENT_INPUT') {
        throw new Error('WORKOUT_SETUP_INCOMPLETE');
      }
      if (generated.status === 'NO_VIABLE_CANDIDATE' || !generated.plan) {
        // This is a contract result, not an exception-string-only failure. It
        // deliberately contains no user data and can be rendered by future V10
        // surfaces without fabricating a workout.
        return generated;
      }
      const plan = generated.plan;
      let timeZone = 'UTC';
      try {
        const profile = await this.userProfile?.getProfile(userId);
        if (profile?.timezone) timeZone = String(profile.timezone);
      } catch {
        timeZone = 'UTC';
      }

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const version = await this.repository.nextVersion(userId);
        try {
          const saved = await this.repository.savePlan(userId, version, plan, {
            status: 'active',
            algorithmVersion: ALGORITHM_VERSION,
            inputSnapshotJson: {
              ...input,
              algorithmVersion: ALGORITHM_VERSION,
              generatorContractVersion: GENERATOR_CONTRACT_VERSION,
              workoutCatalogReleaseId: release.id,
              workoutCatalogReleaseCode: release.code,
              decisionTrace: generated.trace,
              timeZone,
            },
            generatedAt: new Date(),
            workoutCatalogReleaseId: release.id,
            workoutCatalogReleaseCode: release.code,
            timeZone,
          });
          return toWorkoutPlanSummary(userId, saved.version, plan, saved.id, {
            algorithmVersion: ALGORITHM_VERSION,
            status: 'active',
            generatorContractVersion: GENERATOR_CONTRACT_VERSION,
            catalogReleaseId: release.id,
            decisionTraceId: generated.trace.traceId,
          });
        } catch (err) {
          if (!isUniqueViolation(err) || attempt === 3) throw err;
        }
      }
      throw new Error('WORKOUT_PLAN_GENERATE_FAILED');
    };

    if (!this.db) return run();

    const locked = await this.db.withSessionAdvisoryLock(
      WORKOUT_GENERATE_LOCK_KEY,
      `workout-generate:${userId}`,
      run,
    );
    if (!locked.acquired) throw new Error('WORKOUT_PLAN_GENERATE_IN_PROGRESS');
    return locked.result;
  }

  async getWeekView(userId: string) {
    const active = await this.repository.findLatestByUserId(userId);
    if (!active) return { userId, version: 0, planId: undefined, days: [] };
    const plan = await this.applyActiveOverrides(active.id, active.plan);
    return {
      userId,
      version: active.version,
      planId: active.id,
      algorithmVersion: active.algorithmVersion,
      days: plan.days,
    };
  }

  async getTodayView(userId: string, date?: string) {
    const week = await this.getWeekView(userId);
    const parsed = date ? new Date(`${date}T12:00:00`) : new Date();
    if (Number.isNaN(parsed.getTime())) throw new Error('WORKOUT_DATE_INVALID');
    const dayIndex = (parsed.getDay() + 6) % 7;
    return { ...week, dayIndex, day: week.days.find((day) => day.dayIndex === dayIndex) ?? null };
  }

  async listReplacementOptions(userId: string, dayIndex: number) {
    assertDayIndex(dayIndex);
    const active = await this.repository.findLatestByUserId(userId);
    if (!active) throw new Error('WORKOUT_PLAN_NOT_FOUND');
    const options: Array<{
      type: WorkoutReplacementType;
      titleRu: string;
      moveTargetDayIndex?: number;
    }> = [
      { type: 'HOME_SHORT', titleRu: 'Короткая домашняя тренировка' },
      { type: 'WALK', titleRu: 'Прогулка' },
      { type: 'RECOVERY', titleRu: 'Восстановление' },
      { type: 'LIGHTER', titleRu: 'Облегчённая тренировка' },
    ];
    const original = active.plan.days.find((day) => day.dayIndex === dayIndex);
    if (original && !original.isRestDay) {
      const effective = await this.applyActiveOverrides(active.id, active.plan);
      const moveTarget = findLegalMoveTarget(effective.days, dayIndex, original);
      if (moveTarget != null) {
        options.push({
          type: 'MOVE_DAY',
          titleRu: 'Перенести тренировку',
          moveTargetDayIndex: moveTarget,
        });
      }
    }
    return options;
  }

  async applyReplacement(
    userId: string,
    input: { dayIndex: number; replacementType: WorkoutReplacementType; moveTargetDayIndex?: number },
  ) {
    if (!this.workoutProfiles) throw new Error('WORKOUT_PROFILE_REPOSITORY_UNAVAILABLE');
    assertDayIndex(input.dayIndex);
    validateReplacementType(input.replacementType);
    if (input.replacementType === 'MOVE_DAY') {
      assertDayIndex(input.moveTargetDayIndex);
      if (input.moveTargetDayIndex === input.dayIndex) throw new Error('WORKOUT_MOVE_TARGET_INVALID');
    }
    const active = await this.repository.findLatestByUserId(userId);
    if (!active) throw new Error('WORKOUT_PLAN_NOT_FOUND');
    const current = await this.workoutProfiles.findActiveOverride(active.id, input.dayIndex);
    if (
      current?.replacementType === input.replacementType &&
      current.moveTargetDayIndex === (input.moveTargetDayIndex ?? null)
    ) return current;

    const original = active.plan.days.find((day) => day.dayIndex === input.dayIndex);
    if (!original) throw new Error('WORKOUT_DAY_NOT_FOUND');
    if (input.replacementType === 'MOVE_DAY' && input.moveTargetDayIndex != null) {
      const effective = await this.applyActiveOverrides(active.id, active.plan);
      assertMoveTargetAllowed(effective.days, input.dayIndex, input.moveTargetDayIndex, original);
    }
    let homeExercises: WorkoutPlanDayDetail['exercises'] | undefined;
    let replacementTrace: WorkoutGeneratorDecisionTrace | undefined;
    if (input.replacementType === 'HOME_SHORT') {
      const profile = await this.getOrCreateWorkoutProfile(userId);
      if (!this.catalogReleases) {
        throw new Error('WORKOUT_CATALOG_RELEASE_SERVICE_UNAVAILABLE');
      }
      const { release, exercises: releaseCatalog } =
        await this.catalogReleases.listGeneratorEligibleExercises();
      const selection = selectHomeShortReplacementForPilot(releaseCatalog, {
        trainingLevel: profile.trainingLevel,
        trainingPlace: 'HOME',
        equipmentCodes: profile.workoutEquipment,
        excludedKeys: profile.excludedExerciseKeys,
        goalKind: 'replacement',
        workoutsPerWeek: profile.workoutsPerWeek,
      }, {
        id: release.id, code: release.code, manifestVersion: release.manifestVersion,
      }, {
        sourceWorkoutPlanId: active.id,
        sourcePlanVersion: active.version,
        originalExerciseKeys: original.exercises.map((exercise) => exercise.exerciseKey ?? exercise.exerciseName),
      });
      if (selection.status === 'NO_VIABLE_CANDIDATE') return selection;
      replacementTrace = selection.trace;
      const prescription = original.exercises[0];
      homeExercises = selection.exercises.map((exercise, exerciseOrder) => ({
        exerciseOrder,
        exerciseName: exercise.key,
        exerciseKey: exercise.key,
        exerciseId: exercise.id ?? null,
        riskLevel: exercise.riskLevel,
        sets: prescription?.sets ?? 2,
        repsMin: prescription?.repsMin ?? 10,
        repsMax: prescription?.repsMax ?? 12,
        restSeconds: prescription?.restSeconds ?? 60,
      }));
    }
    const snapshot = replacementSnapshot(original, input.replacementType, homeExercises);
    if (replacementTrace) snapshot.decisionTrace = replacementTrace;
    return this.workoutProfiles.replaceActiveOverride({
      userId,
      workoutPlanId: active.id,
      dayIndex: input.dayIndex,
      replacementType: input.replacementType,
      replacementDayTitle: snapshot.dayTitle ?? null,
      replacementSnapshot: snapshot,
      moveTargetDayIndex: input.moveTargetDayIndex,
    });
  }

  async revertReplacement(userId: string, overrideId: string) {
    if (!this.workoutProfiles) throw new Error('WORKOUT_PROFILE_REPOSITORY_UNAVAILABLE');
    const result = await this.workoutProfiles.revert(userId, overrideId);
    if (!result) throw new Error('WORKOUT_OVERRIDE_NOT_FOUND');
    return result;
  }

  async getExerciseDetail(_userId: string, exerciseKey: string) {
    if (!this.catalogReleases) {
      throw new Error('WORKOUT_CATALOG_RELEASE_SERVICE_UNAVAILABLE');
    }
    return this.catalogReleases.getPublishedExerciseDetail(exerciseKey);
  }

  private async applyActiveOverrides(planId: string, plan: WorkoutPlanDetail): Promise<WorkoutPlanDetail> {
    if (!this.workoutProfiles) return plan;
    const overrides = await this.workoutProfiles.listActiveOverrides(planId);
    if (!overrides.length) return plan;
    const original = new Map(plan.days.map((day) => [day.dayIndex, day]));
    const days = plan.days.map((day) => {
      const override = overrides.find((item) => item.dayIndex === day.dayIndex);
      return override ? override.replacementSnapshot : day;
    });
    for (const override of overrides) {
      if (override.replacementType !== 'MOVE_DAY' || override.moveTargetDayIndex == null) continue;
      const moved = original.get(override.dayIndex);
      const target = days.findIndex((day) => day.dayIndex === override.moveTargetDayIndex);
      if (moved && target >= 0) {
        days[target] = {
          ...moved,
          dayIndex: override.moveTargetDayIndex,
          sourceDayIndex: override.dayIndex,
          dayTitle: 'Перенесённая тренировка',
        };
      }
    }
    return { days: days.sort((a, b) => a.dayIndex - b.dayIndex) };
  }

  /** Test helper — build detail from DEFAULT_EXERCISES (not used on read path). */
  buildDefaultDetail(): WorkoutPlanDetail {
    const legacy = this.build(DEFAULT_EXERCISES);
    return {
      days: legacy.days.map((day) => ({
        dayIndex: day.dayIndex,
        isRestDay: false,
        exercises: day.exercises.map((ex, order) => ({
          exerciseOrder: order,
          exerciseName: ex.name,
          riskLevel: ex.riskLevel,
        })),
      })),
    };
  }
}

const TRAINING_LEVELS = new Set(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
const TRAINING_PLACES = new Set(['HOME', 'GYM', 'MIXED']);
const DURATIONS = new Set(['SHORT', 'STANDARD', 'LONG']);
const REPLACEMENT_TYPES = new Set(['HOME_SHORT', 'WALK', 'RECOVERY', 'MOVE_DAY', 'LIGHTER']);

function validateProfilePatch(patch: WorkoutProfilePatch): WorkoutProfilePatch {
  if (patch.trainingLevel && !TRAINING_LEVELS.has(patch.trainingLevel)) {
    throw new Error('WORKOUT_PROFILE_TRAINING_LEVEL_INVALID');
  }
  if (patch.trainingPlace && !TRAINING_PLACES.has(patch.trainingPlace)) {
    throw new Error('WORKOUT_PROFILE_TRAINING_PLACE_INVALID');
  }
  if (patch.preferredDuration && !DURATIONS.has(patch.preferredDuration)) {
    throw new Error('WORKOUT_PROFILE_DURATION_INVALID');
  }
  if (
    patch.workoutsPerWeek != null &&
    (!Number.isInteger(patch.workoutsPerWeek) || patch.workoutsPerWeek < 2 || patch.workoutsPerWeek > 5)
  ) {
    throw new Error('WORKOUT_PROFILE_FREQUENCY_INVALID');
  }
  if (patch.availableDays) {
    if (
      patch.availableDays.length === 0 ||
      patch.availableDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) throw new Error('WORKOUT_PROFILE_DAYS_INVALID');
    patch = { ...patch, availableDays: [...new Set(patch.availableDays)].sort((a, b) => a - b) };
  }
  if (patch.workoutEquipment) {
    const equipment = asWorkoutEquipment(patch.workoutEquipment);
    if (equipment.length !== patch.workoutEquipment.length) {
      throw new Error('WORKOUT_PROFILE_EQUIPMENT_INVALID');
    }
    patch = { ...patch, workoutEquipment: equipment as WorkoutProfile['workoutEquipment'] };
  }
  return patch;
}

function assertDayIndex(dayIndex: number | undefined): asserts dayIndex is number {
  if (!Number.isInteger(dayIndex) || dayIndex == null || dayIndex < 0 || dayIndex > 6) {
    throw new Error('WORKOUT_DAY_INDEX_INVALID');
  }
}

function isStrengthDay(day: {
  isRestDay?: boolean;
  exercises: Array<{ exerciseKey?: string | null; exerciseName?: string }>;
}): boolean {
  if (day.isRestDay) return false;
  const keys = day.exercises.map((exercise) => exercise.exerciseKey ?? exercise.exerciseName ?? '');
  if (keys.length === 0) return false;
  if (keys.every((key) =>
    key === 'rest' || key === 'recovery_walk' || key === 'morning_walk' || key === 'stretching'
  )) {
    return false;
  }
  return true;
}

function isOccupiedDay(day: {
  isRestDay?: boolean;
  exercises: Array<{ exerciseKey?: string | null; exerciseName?: string }>;
}): boolean {
  if (day.isRestDay) return false;
  return day.exercises.some((exercise) => {
    const key = exercise.exerciseKey ?? exercise.exerciseName ?? '';
    return key !== '' && key !== 'rest';
  });
}

function assertMoveTargetAllowed(
  days: WorkoutPlanDayDetail[],
  sourceDayIndex: number,
  targetDayIndex: number,
  sourceOriginal: WorkoutPlanDayDetail,
) {
  const target = days.find((day) => day.dayIndex === targetDayIndex);
  if (target && isOccupiedDay(target)) {
    throw new Error('WORKOUT_MOVE_TARGET_OCCUPIED');
  }
  if (!isStrengthDay(sourceOriginal)) return;
  // Source becomes recovery after the move — do not treat it as a heavy neighbor.
  const neighbors = [targetDayIndex - 1, targetDayIndex + 1]
    .filter((day) => day >= 0 && day <= 6 && day !== sourceDayIndex)
    .map((day) => days.find((item) => item.dayIndex === day))
    .filter((day): day is WorkoutPlanDayDetail => Boolean(day));
  if (neighbors.some((day) => isStrengthDay(day))) {
    throw new Error('WORKOUT_MOVE_HEAVY_ADJACENT');
  }
}

function findLegalMoveTarget(
  days: WorkoutPlanDayDetail[],
  sourceDayIndex: number,
  sourceOriginal: WorkoutPlanDayDetail,
): number | null {
  for (let offset = 1; offset <= 6; offset += 1) {
    const candidate = (sourceDayIndex + offset) % 7;
    try {
      assertMoveTargetAllowed(days, sourceDayIndex, candidate, sourceOriginal);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function validateReplacementType(type: string): asserts type is WorkoutReplacementType {
  if (!REPLACEMENT_TYPES.has(type)) throw new Error('WORKOUT_REPLACEMENT_TYPE_INVALID');
}

function replacementSnapshot(
  original: WorkoutPlanDayDetail,
  type: WorkoutReplacementType,
  homeExercises?: WorkoutPlanDayDetail['exercises'],
): WorkoutPlanDayDetail {
  if (type === 'WALK') {
    return {
      dayIndex: original.dayIndex,
      dayTitle: 'Прогулка',
      isRestDay: false,
      trainingPlace: 'HOME',
      estimatedMinutes: 30,
      exercises: [{
        exerciseOrder: 0,
        exerciseName: 'recovery_walk',
        exerciseKey: 'recovery_walk',
        riskLevel: 'low',
        sets: 1,
        repsMin: 30,
        repsMax: 30,
        restSeconds: 0,
      }],
    };
  }
  if (type === 'RECOVERY' || type === 'MOVE_DAY') {
    return {
      dayIndex: original.dayIndex,
      dayTitle: type === 'MOVE_DAY' ? 'День восстановления' : 'Восстановление',
      isRestDay: true,
      estimatedMinutes: 0,
      exercises: [],
    };
  }
  const limit = type === 'HOME_SHORT' ? 3 : original.exercises.length;
  return {
    ...original,
    dayTitle: type === 'HOME_SHORT' ? 'Короткая домашняя тренировка' : 'Облегчённая тренировка',
    trainingPlace: type === 'HOME_SHORT' ? 'HOME' : original.trainingPlace,
    estimatedMinutes: type === 'HOME_SHORT'
      ? Math.min(original.estimatedMinutes ?? 15, 15)
      : original.estimatedMinutes,
    exercises: (type === 'HOME_SHORT' && homeExercises ? homeExercises : original.exercises.slice(0, limit))
      .map((exercise, exerciseOrder) => ({
      ...exercise,
      exerciseOrder,
      sets: type === 'LIGHTER' && exercise.sets != null
        ? Math.max(1, exercise.sets - 1)
        : exercise.sets,
      })),
  };
}
