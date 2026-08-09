import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { UserProfileService } from '../../user-profile/application/user-profile.service';
import { WorkoutCatalogReleaseService } from '../catalog/workout-catalog-release.service';
import {
  computeApplyRequestHash,
  computeOptionFingerprint,
  computeSessionStateHash,
  computeUndoRequestHash,
  dateOnlyInTimeZone,
  dayIndexInTimeZone,
  normalizeTimeZone,
} from '../domain/workout-adaptation.fingerprint';
import {
  WORKOUT_ADAPTATION_HISTORY_DEFAULT_LIMIT,
  WORKOUT_ADAPTATION_HISTORY_MAX_LIMIT,
  WORKOUT_ADAPTATION_INTENTS,
  WORKOUT_ADAPTATION_LOCK_NAMESPACE,
  WORKOUT_ADAPTATION_POLICY_VERSION,
  type AdaptationApplyResult,
  type AdaptationPreview,
  type AdaptationSessionSnapshot,
  type WorkoutAdaptationIntent,
} from '../domain/workout-adaptation.types';
import { buildAdaptationPreview, findOption, listMoveDayTargets, type VariantEdge } from '../domain/workout-adaptation.policy';
import type { WorkoutSessionView } from '../domain/workout-session.types';
import { WorkoutEngineService } from './workout-engine.service';
import { WorkoutAdaptationRepository } from '../infrastructure/workout-adaptation.repository';
import { WorkoutSessionRepository } from '../infrastructure/workout-session.repository';
import { WorkoutEnergyService } from '../energy/workout-energy.service';
import { ExerciseEnergyTimingProfileRepository } from '../energy/exercise-energy-timing-profile.repository';
import { buildPlannedExerciseEnergySnapshot } from '../energy/workout-session-energy-snapshot';

export type AdaptationApplyInput = {
  intent: WorkoutAdaptationIntent;
  optionCode: string;
  expectedSessionVersion: number;
  expectedCatalogReleaseId: string | null;
  policyVersion: string;
  optionFingerprint: string;
  idempotencyKey: string;
};

export type AdaptationUndoInput = {
  expectedSessionVersion: number;
  adaptationId: string;
  idempotencyKey: string;
};

@Injectable()
export class WorkoutAdaptationService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WorkoutSessionRepository) private readonly sessions: WorkoutSessionRepository,
    @Inject(WorkoutCatalogReleaseService) private readonly catalogReleases: WorkoutCatalogReleaseService,
    @Inject(WorkoutEngineService) private readonly workoutEngine: WorkoutEngineService,
    @Inject(WorkoutAdaptationRepository) private readonly adaptations: WorkoutAdaptationRepository,
    @Optional() @Inject(UserProfileService) private readonly userProfiles?: UserProfileService,
    @Optional() @Inject(WorkoutEnergyService) private readonly workoutEnergy?: WorkoutEnergyService,
    @Optional()
    @Inject(ExerciseEnergyTimingProfileRepository)
    private readonly timingProfiles?: ExerciseEnergyTimingProfileRepository,
  ) {}

  async preview(userId: string, sessionId: string, intent: WorkoutAdaptationIntent): Promise<AdaptationPreview> {
    this.assertIntent(intent);
    const session = await this.requireActiveSession(userId, sessionId);
    return this.buildPreview(userId, session, intent);
  }

  async apply(userId: string, sessionId: string, input: AdaptationApplyInput): Promise<AdaptationApplyResult> {
    this.assertIntent(input.intent);
    if (!input.optionCode || !Number.isInteger(input.expectedSessionVersion)) {
      throw new Error('WORKOUT_ADAPTATION_OPTION_EXPIRED');
    }
    if (input.policyVersion !== WORKOUT_ADAPTATION_POLICY_VERSION) {
      throw new Error('WORKOUT_ADAPTATION_OPTION_EXPIRED');
    }
    if (!input.idempotencyKey) throw new Error('WORKOUT_ADAPTATION_IDEMPOTENCY_REQUIRED');
    if (!input.optionFingerprint) throw new Error('WORKOUT_ADAPTATION_OPTION_EXPIRED');

    const requestHash = computeApplyRequestHash({
      action: 'APPLY',
      workoutSessionId: sessionId,
      intent: input.intent,
      optionCode: input.optionCode,
      expectedSessionVersion: input.expectedSessionVersion,
      expectedCatalogReleaseId: input.expectedCatalogReleaseId,
      policyVersion: input.policyVersion,
      optionFingerprint: input.optionFingerprint,
    });

    return this.db.withTransaction(async (query) => {
      await this.lockSession(query, sessionId);

      const replay = await this.adaptations.findCommand(userId, sessionId, 'APPLY', input.idempotencyKey, query);
      if (replay) {
        if (replay.requestHash !== requestHash) throw new Error('WORKOUT_ADAPTATION_IDEMPOTENCY_CONFLICT');
        return { ...replay.responseSnapshot, idempotentReplay: true };
      }

      const locked = await query<{ id: string; status: string; version: number }>(
        `SELECT id, status, version FROM "WorkoutSession" WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
        [sessionId, userId],
      );
      const row = locked.rows[0];
      if (!row) throw new Error('WORKOUT_SESSION_NOT_FOUND');
      this.assertActiveStatus(row.status);
      if (row.version !== input.expectedSessionVersion) throw new Error('WORKOUT_ADAPTATION_STALE_VERSION');

      const published = await this.catalogReleases.resolveCurrentPublishedRelease();
      if (!published) throw new Error('WORKOUT_CATALOG_RELEASE_MISSING');
      if (published.id !== input.expectedCatalogReleaseId) {
        throw new Error('WORKOUT_ADAPTATION_CATALOG_STALE');
      }

      const session = await this.sessions.findByIdForUser(userId, sessionId);
      if (!session) throw new Error('WORKOUT_SESSION_NOT_FOUND');
      const preview = await this.buildPreview(userId, session, input.intent);
      if (preview.catalogReleaseId !== input.expectedCatalogReleaseId) {
        throw new Error('WORKOUT_ADAPTATION_CATALOG_STALE');
      }
      if (!preview.recommended && preview.alternatives.length === 0) {
        throw new Error('WORKOUT_ADAPTATION_NO_ALTERNATIVES');
      }
      const option = findOption(preview, input.optionCode);
      if (!option) throw new Error('WORKOUT_ADAPTATION_OPTION_EXPIRED');
      const rebuiltFingerprint = computeOptionFingerprint({
        intent: input.intent,
        optionCode: option.optionCode,
        policyVersion: preview.policyVersion,
        catalogReleaseId: preview.catalogReleaseId,
        sessionVersion: preview.sessionVersion,
        option,
      });
      if (rebuiltFingerprint !== input.optionFingerprint || option.optionFingerprint !== input.optionFingerprint) {
        throw new Error('WORKOUT_ADAPTATION_OPTION_EXPIRED');
      }
      if (option.preview.effectiveDayIndex !== session.effectiveDayIndex) {
        await this.assertMoveTargetAvailable(userId, session, option.preview.effectiveDayIndex);
        option.preview.effectiveDate = moveDate(
          session.effectiveDate,
          session.effectiveDayIndex,
          option.preview.effectiveDayIndex,
        );
      }

      const beforeSnapshot = await this.snapshotFor(session);
      const enrichedPreview = await this.enrichPreviewEnergy(
        userId,
        session,
        beforeSnapshot,
        option.preview,
      );
      const updated = await this.sessions.replaceSessionContent(
        query, userId, sessionId, input.expectedSessionVersion, enrichedPreview,
      );
      const afterSnapshot = await this.snapshotFor(updated);
      afterSnapshot.stateHash = computeSessionStateHash(afterSnapshot);
      beforeSnapshot.stateHash = computeSessionStateHash(beforeSnapshot);

      const adaptation = await this.adaptations.insertApplied({
        userId,
        workoutPlanId: session.workoutPlanId,
        workoutSessionId: sessionId,
        intent: input.intent,
        selectedOptionCode: option.optionCode,
        policyVersion: preview.policyVersion,
        catalogReleaseId: published.id,
        sessionVersionBefore: input.expectedSessionVersion,
        sessionVersionAfter: updated.version,
        beforeSnapshot,
        afterSnapshot,
        goalImpactSnapshot: option.goalImpact,
        idempotencyKey: input.idempotencyKey,
      }, query);

      const result: AdaptationApplyResult = {
        adaptation,
        session: afterSnapshot,
        idempotentReplay: false,
      };
      await this.adaptations.insertCommand({
        userId,
        workoutSessionId: sessionId,
        action: 'APPLY',
        idempotencyKey: input.idempotencyKey,
        requestHash,
        adaptationId: adaptation.id,
        responseSnapshot: result,
      }, query);
      return result;
    });
  }

  async undo(userId: string, sessionId: string, input: AdaptationUndoInput): Promise<AdaptationApplyResult> {
    if (!Number.isInteger(input.expectedSessionVersion)) {
      throw new Error('WORKOUT_ADAPTATION_STALE_VERSION');
    }
    if (!input.idempotencyKey) throw new Error('WORKOUT_ADAPTATION_IDEMPOTENCY_REQUIRED');
    if (!input.adaptationId) throw new Error('WORKOUT_ADAPTATION_UNDO_UNAVAILABLE');

    const requestHash = computeUndoRequestHash({
      action: 'UNDO',
      workoutSessionId: sessionId,
      adaptationId: input.adaptationId,
      expectedSessionVersion: input.expectedSessionVersion,
    });

    return this.db.withTransaction(async (query) => {
      await this.lockSession(query, sessionId);

      const replay = await this.adaptations.findCommand(userId, sessionId, 'UNDO', input.idempotencyKey, query);
      if (replay) {
        if (replay.requestHash !== requestHash) throw new Error('WORKOUT_ADAPTATION_IDEMPOTENCY_CONFLICT');
        return { ...replay.responseSnapshot, idempotentReplay: true };
      }

      const locked = await query<{ id: string; status: string; version: number }>(
        `SELECT id, status, version FROM "WorkoutSession" WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
        [sessionId, userId],
      );
      const row = locked.rows[0];
      if (!row) throw new Error('WORKOUT_SESSION_NOT_FOUND');
      this.assertActiveStatus(row.status);

      const adaptation = await this.adaptations.findLatestApplied(sessionId, query);
      if (!adaptation) throw new Error('WORKOUT_ADAPTATION_UNDO_UNAVAILABLE');
      if (input.adaptationId !== adaptation.id) {
        throw new Error('WORKOUT_ADAPTATION_UNDO_UNAVAILABLE');
      }
      if (row.version !== adaptation.sessionVersionAfter) {
        throw new Error('WORKOUT_ADAPTATION_STALE_VERSION');
      }
      if (input.expectedSessionVersion !== adaptation.sessionVersionAfter) {
        throw new Error('WORKOUT_ADAPTATION_STALE_VERSION');
      }

      const session = await this.sessions.findByIdForUser(userId, sessionId);
      if (!session) throw new Error('WORKOUT_SESSION_NOT_FOUND');
      const current = await this.snapshotFor(session);
      const currentHash = computeSessionStateHash(current);
      const expectedHash = adaptation.afterSnapshot.stateHash ?? computeSessionStateHash(adaptation.afterSnapshot);
      if (currentHash !== expectedHash) {
        throw new Error('WORKOUT_ADAPTATION_STALE_VERSION');
      }

      if (adaptation.intent === 'MOVE_DAY') {
        await this.assertMoveTargetAvailable(
          userId, session,
          adaptation.beforeSnapshot.effectiveDayIndex,
          true,
          adaptation.beforeSnapshot.effectiveDate,
        );
      }

      const restored = await this.sessions.replaceSessionContent(
        query, userId, sessionId, row.version, adaptation.beforeSnapshot,
      );
      const undone = await this.adaptations.markUndone(adaptation.id, query);
      if (!undone) throw new Error('WORKOUT_ADAPTATION_UNDO_UNAVAILABLE');
      const restoredSnapshot = await this.snapshotFor(restored);
      restoredSnapshot.stateHash = computeSessionStateHash(restoredSnapshot);
      const result: AdaptationApplyResult = {
        adaptation: undone,
        session: restoredSnapshot,
        idempotentReplay: false,
      };
      await this.adaptations.insertCommand({
        userId,
        workoutSessionId: sessionId,
        action: 'UNDO',
        idempotencyKey: input.idempotencyKey,
        requestHash,
        adaptationId: adaptation.id,
        responseSnapshot: result,
      }, query);
      return result;
    });
  }

  async history(userId: string, sessionId: string, limit?: number) {
    const session = await this.sessions.findByIdForUser(userId, sessionId);
    if (!session) throw new Error('WORKOUT_SESSION_NOT_FOUND');
    const bounded = Math.min(
      WORKOUT_ADAPTATION_HISTORY_MAX_LIMIT,
      Math.max(1, limit ?? WORKOUT_ADAPTATION_HISTORY_DEFAULT_LIMIT),
    );
    return this.adaptations.listBySession(sessionId, bounded);
  }

  private async buildPreview(
    userId: string,
    session: WorkoutSessionView,
    intent: WorkoutAdaptationIntent,
  ) {
    const timeZone = await this.resolveTimeZone(userId, session.workoutPlanId);
    const [snapshot, catalogResult, profile, week, edges] = await Promise.all([
      this.snapshotFor(session),
      this.catalogReleases.listGeneratorEligibleExercises(),
      this.workoutEngine.getOrCreateWorkoutProfile(userId),
      this.workoutEngine.getWeekView(userId),
      this.loadVariantEdges(),
    ]);
    snapshot.catalogReleaseId = catalogResult.release.id;
    snapshot.stateHash = computeSessionStateHash(snapshot);
    const preview = buildAdaptationPreview({
      intent,
      session: snapshot,
      catalog: catalogResult.exercises,
      edges,
      profile: {
        trainingLevel: profile.trainingLevel,
        workoutEquipment: profile.workoutEquipment,
        excludedExerciseKeys: profile.excludedExerciseKeys,
      },
      weekDays: week.days.map((day) => ({
        dayIndex: day.dayIndex,
        isRestDay: day.isRestDay,
        exerciseKeys: day.exercises.map((exercise) => exercise.exerciseKey ?? exercise.exerciseName),
      })),
      todayDayIndex: dayIndexInTimeZone(timeZone),
      timeZone,
    });
    return {
      ...preview,
      catalogReleaseId: catalogResult.release.id,
      timeZone,
    };
  }

  private async resolveTimeZone(userId: string, workoutPlanId: string | null): Promise<string> {
    if (workoutPlanId) {
      const plan = await this.db.query<{ timeZone: string | null }>(
        `SELECT "timeZone" FROM "WorkoutPlan" WHERE id = $1`,
        [workoutPlanId],
      );
      if (plan.rows[0]?.timeZone) return normalizeTimeZone(plan.rows[0].timeZone);
    }
    if (this.userProfiles) {
      try {
        const profile = await this.userProfiles.getProfile(userId);
        if (profile?.timezone) return normalizeTimeZone(profile.timezone);
      } catch {
        // fall through to UTC
      }
    }
    const row = await this.db.query<{ timezone: string | null }>(
      `SELECT timezone FROM "UserProfile" WHERE "userId" = $1`,
      [userId],
    );
    return normalizeTimeZone(row.rows[0]?.timezone ?? 'UTC');
  }

  private async assertMoveTargetAvailable(
    userId: string,
    session: WorkoutSessionView,
    targetDayIndex: number,
    restoring = false,
    restoreEffectiveDate?: string,
  ): Promise<void> {
    // When restoring: check occupancy, past date, and current week window — not plan content.
    if (restoring) {
      // 1. Conflict if another session for this user already sits on the restore day.
      const conflict = await this.db.query<{ id: string }>(
        `SELECT id FROM "WorkoutSession"
         WHERE "userId" = $1
           AND "effectiveDayIndex" = $2
           AND status IN ('ACTIVE', 'COMPLETED')
           AND id <> $3
         LIMIT 1`,
        [userId, targetDayIndex, session.id],
      );
      if (conflict.rows.length > 0) {
        throw new Error('WORKOUT_MOVE_DATE_CONFLICT');
      }

      const timeZone = await this.resolveTimeZone(userId, session.workoutPlanId);

      // 2. Conflict if the restore date has already passed in the user's timezone.
      if (restoreEffectiveDate) {
        const today = dateOnlyInTimeZone(timeZone);
        if (restoreEffectiveDate < today) {
          throw new Error('WORKOUT_MOVE_DATE_CONFLICT');
        }
      }

      // 3. Conflict if restore dayIndex is outside the user's current available week window.
      const profile = await this.workoutEngine.getOrCreateWorkoutProfile(userId);
      if (!profile.availableDays.includes(targetDayIndex)) {
        throw new Error('WORKOUT_MOVE_DATE_CONFLICT');
      }

      return;
    }

    const week = await this.workoutEngine.getWeekView(userId);
    const timeZone = await this.resolveTimeZone(userId, session.workoutPlanId);
    const today = dayIndexInTimeZone(timeZone);
    const targets = listMoveDayTargets(
      session.effectiveDayIndex,
      week.days.map((day) => ({
        dayIndex: day.dayIndex,
        isRestDay: day.isRestDay,
        exerciseKeys: day.exercises.map((exercise) => exercise.exerciseKey ?? exercise.exerciseName),
      })),
      [],
      today,
    );
    if (!targets.includes(targetDayIndex)) throw new Error('WORKOUT_MOVE_DATE_CONFLICT');
  }

  private async snapshotFor(session: WorkoutSessionView): Promise<AdaptationSessionSnapshot> {
    const release = session.workoutPlanId
      ? await this.db.query<{ workoutCatalogReleaseId: string | null }>(
        `SELECT "workoutCatalogReleaseId" FROM "WorkoutPlan" WHERE id = $1`, [session.workoutPlanId],
      )
      : null;
    const catalogReleaseId = session.exercises.find((exercise) => exercise.catalogReleaseId)?.catalogReleaseId
      ?? release?.rows[0]?.workoutCatalogReleaseId
      ?? null;
    const energyRows = await this.db.query<{
      orderIndex: number;
      energyEstimateStatus: string | null;
      plannedGrossEstimatedKcal: string | null;
      plannedRestingEstimatedKcal: string | null;
      plannedIncrementalEstimatedKcal: string | null;
      energyWeightKgUsed: string | null;
      energyWeightSource: string | null;
      energyWeightSourceRecordedAt: Date | string | null;
      energyActiveSecondsUsed: string | null;
      exerciseEnergyProfileId: string | null;
      exerciseEnergyTimingProfileId: string | null;
      energyCalculationMethod: string | null;
      energyPopulationType: string | null;
      energyPolicyVersion: string | null;
      energySourceVersion: string | null;
      energyCalculatedAt: Date | string | null;
    }>(
      `SELECT "orderIndex", "energyEstimateStatus",
              "plannedGrossEstimatedKcal"::text AS "plannedGrossEstimatedKcal",
              "plannedRestingEstimatedKcal"::text AS "plannedRestingEstimatedKcal",
              "plannedIncrementalEstimatedKcal"::text AS "plannedIncrementalEstimatedKcal",
              "energyWeightKgUsed"::text AS "energyWeightKgUsed",
              "energyWeightSource",
              "energyWeightSourceRecordedAt",
              "energyActiveSecondsUsed"::text AS "energyActiveSecondsUsed",
              "exerciseEnergyProfileId", "exerciseEnergyTimingProfileId",
              "energyCalculationMethod", "energyPopulationType",
              "energyPolicyVersion", "energySourceVersion", "energyCalculatedAt"
       FROM "WorkoutSessionExercise"
       WHERE "sessionId" = $1`,
      [session.id],
    );
    const energyByOrder = new Map(energyRows.rows.map((row) => [row.orderIndex, row]));
    const toNumber = (value: string | null | undefined): number | null => {
      if (value == null || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const toIso = (value: Date | string | null | undefined): string | null => {
      if (value == null) return null;
      if (value instanceof Date) return value.toISOString();
      return String(value);
    };
    const snapshot: AdaptationSessionSnapshot = {
      id: session.id,
      workoutPlanId: session.workoutPlanId,
      sourceDayIndex: session.sourceDayIndex,
      effectiveDayIndex: session.effectiveDayIndex,
      effectiveDate: session.effectiveDate,
      dayTitle: session.dayTitle,
      estimatedMinutes: session.estimatedMinutes,
      version: session.version,
      catalogReleaseId,
      exercises: session.exercises.map((exercise) => {
        const energy = energyByOrder.get(exercise.orderIndex);
        return {
          orderIndex: exercise.orderIndex,
          exerciseKey: exercise.exerciseKey,
          sourceExerciseId: exercise.sourceExerciseId,
          exerciseRevisionId: exercise.exerciseRevisionId,
          catalogReleaseId: exercise.catalogReleaseId ?? catalogReleaseId,
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
          breathingRu: exercise.breathingRu,
          breathingEn: exercise.breathingEn,
          stopConditionsRu: exercise.stopConditionsRu,
          stopConditionsEn: exercise.stopConditionsEn,
          media: exercise.media,
          energyEstimateStatus: energy?.energyEstimateStatus ?? null,
          plannedGrossEstimatedKcal: toNumber(energy?.plannedGrossEstimatedKcal),
          plannedRestingEstimatedKcal: toNumber(energy?.plannedRestingEstimatedKcal),
          plannedIncrementalEstimatedKcal: toNumber(energy?.plannedIncrementalEstimatedKcal),
          energyWeightKgUsed: toNumber(energy?.energyWeightKgUsed),
          energyWeightSource: energy?.energyWeightSource ?? null,
          energyWeightSourceRecordedAt: toIso(energy?.energyWeightSourceRecordedAt),
          energyActiveSecondsUsed: toNumber(energy?.energyActiveSecondsUsed),
          exerciseEnergyProfileId: energy?.exerciseEnergyProfileId ?? null,
          exerciseEnergyTimingProfileId: energy?.exerciseEnergyTimingProfileId ?? null,
          energyCalculationMethod: energy?.energyCalculationMethod ?? null,
          energyPopulationType: energy?.energyPopulationType ?? null,
          energyPolicyVersion: energy?.energyPolicyVersion ?? null,
          energySourceVersion: energy?.energySourceVersion ?? null,
          energyCalculatedAt: toIso(energy?.energyCalculatedAt),
        };
      }),
    };
    snapshot.stateHash = computeSessionStateHash(snapshot);
    return snapshot;
  }

  private samePrescription(
    left: AdaptationSessionSnapshot['exercises'][number],
    right: AdaptationSessionSnapshot['exercises'][number],
  ): boolean {
    return (
      left.exerciseKey === right.exerciseKey &&
      left.exerciseRevisionId === right.exerciseRevisionId &&
      left.targetSets === right.targetSets &&
      left.targetRepsMin === right.targetRepsMin &&
      left.targetRepsMax === right.targetRepsMax &&
      left.targetDurationSeconds === right.targetDurationSeconds &&
      left.restSeconds === right.restSeconds
    );
  }

  private copyEnergyFields(
    from: AdaptationSessionSnapshot['exercises'][number],
  ): Pick<
    AdaptationSessionSnapshot['exercises'][number],
    | 'energyEstimateStatus'
    | 'plannedGrossEstimatedKcal'
    | 'plannedRestingEstimatedKcal'
    | 'plannedIncrementalEstimatedKcal'
    | 'energyWeightKgUsed'
    | 'energyWeightSource'
    | 'energyWeightSourceRecordedAt'
    | 'energyActiveSecondsUsed'
    | 'exerciseEnergyProfileId'
    | 'exerciseEnergyTimingProfileId'
    | 'energyCalculationMethod'
    | 'energyPopulationType'
    | 'energyPolicyVersion'
    | 'energySourceVersion'
    | 'energyCalculatedAt'
  > {
    return {
      energyEstimateStatus: from.energyEstimateStatus ?? null,
      plannedGrossEstimatedKcal: from.plannedGrossEstimatedKcal ?? null,
      plannedRestingEstimatedKcal: from.plannedRestingEstimatedKcal ?? null,
      plannedIncrementalEstimatedKcal: from.plannedIncrementalEstimatedKcal ?? null,
      energyWeightKgUsed: from.energyWeightKgUsed ?? null,
      energyWeightSource: from.energyWeightSource ?? null,
      energyWeightSourceRecordedAt: from.energyWeightSourceRecordedAt ?? null,
      energyActiveSecondsUsed: from.energyActiveSecondsUsed ?? null,
      exerciseEnergyProfileId: from.exerciseEnergyProfileId ?? null,
      exerciseEnergyTimingProfileId: from.exerciseEnergyTimingProfileId ?? null,
      energyCalculationMethod: from.energyCalculationMethod ?? null,
      energyPopulationType: from.energyPopulationType ?? null,
      energyPolicyVersion: from.energyPolicyVersion ?? null,
      energySourceVersion: from.energySourceVersion ?? null,
      energyCalculatedAt: from.energyCalculatedAt ?? null,
    };
  }

  private async enrichPreviewEnergy(
    userId: string,
    session: WorkoutSessionView,
    before: AdaptationSessionSnapshot,
    preview: AdaptationSessionSnapshot,
  ): Promise<AdaptationSessionSnapshot> {
    const beforeByOrder = new Map(before.exercises.map((exercise) => [exercise.orderIndex, exercise]));
    const sessionStartedAt = new Date(session.startedAt);
    const adaptationAt = new Date();
    const weightResult = this.workoutEnergy
      ? await this.workoutEnergy.resolveWeight(userId, sessionStartedAt)
      : {
          status: 'UNAVAILABLE_MISSING_WEIGHT' as const,
          weightKg: null,
          source: null,
          sourceRecordedAt: null,
          asOf: sessionStartedAt.toISOString(),
        };

    const exercises = [];
    for (const exercise of preview.exercises) {
      const prior = beforeByOrder.get(exercise.orderIndex);
      if (prior && this.samePrescription(prior, exercise) && prior.energyEstimateStatus != null) {
        exercises.push({ ...exercise, ...this.copyEnergyFields(prior) });
        continue;
      }
      const priorByKey = before.exercises.find(
        (candidate) =>
          candidate.exerciseKey === exercise.exerciseKey &&
          candidate.exerciseRevisionId === exercise.exerciseRevisionId &&
          this.samePrescription(candidate, exercise) &&
          candidate.energyEstimateStatus != null,
      );
      if (priorByKey) {
        exercises.push({ ...exercise, ...this.copyEnergyFields(priorByKey) });
        continue;
      }

      const prescriptionMode =
        exercise.targetDurationSeconds != null
          ? ('DURATION' as const)
          : exercise.targetRepsMin != null || exercise.targetRepsMax != null
            ? ('REPS' as const)
            : null;
      let energyProfile = null as
        | Awaited<ReturnType<NonNullable<typeof this.workoutEnergy>['resolveApprovedProfile']>>
        | { status: 'INVALID_ENERGY_PROFILE' }
        | null;
      let timingProfile = null as
        | Awaited<ReturnType<NonNullable<typeof this.timingProfiles>['resolveApproved']>>
        | { status: 'AMBIGUOUS_TIMING_PROFILE' }
        | null;
      if (exercise.exerciseRevisionId && this.workoutEnergy) {
        try {
          energyProfile = await this.workoutEnergy.resolveApprovedProfile(exercise.exerciseRevisionId);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'INVALID_ENERGY_PROFILE') throw error;
          energyProfile = { status: 'INVALID_ENERGY_PROFILE' };
        }
        if (prescriptionMode === 'REPS' && this.timingProfiles) {
          try {
            timingProfile = await this.timingProfiles.resolveApproved(exercise.exerciseRevisionId);
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'AMBIGUOUS_TIMING_PROFILE') throw error;
            timingProfile = { status: 'AMBIGUOUS_TIMING_PROFILE' };
          }
        }
      }
      const setTargets = Array.from({ length: Math.max(1, exercise.targetSets) }, () => ({
        targetReps: exercise.targetRepsMax ?? exercise.targetRepsMin ?? null,
        targetDurationSeconds: exercise.targetDurationSeconds,
      }));
      const computed = buildPlannedExerciseEnergySnapshot({
        prescriptionMode,
        setTargets,
        weightResult,
        energyProfile,
        timingProfile,
        sessionStartedAt: adaptationAt,
        estimateExerciseEnergy: (input) => {
          if (!this.workoutEnergy) throw new Error('WORKOUT_ENERGY_SERVICE_UNAVAILABLE');
          return this.workoutEnergy.estimateExerciseEnergy(input);
        },
      });
      exercises.push({
        ...exercise,
        energyEstimateStatus: computed.energyEstimateStatus,
        plannedGrossEstimatedKcal: computed.plannedGrossEstimatedKcal,
        plannedRestingEstimatedKcal: computed.plannedRestingEstimatedKcal,
        plannedIncrementalEstimatedKcal: computed.plannedIncrementalEstimatedKcal,
        energyWeightKgUsed: computed.energyWeightKgUsed,
        energyWeightSource: computed.energyWeightSource,
        energyWeightSourceRecordedAt: computed.energyWeightSourceRecordedAt,
        energyActiveSecondsUsed: computed.energyActiveSecondsUsed,
        exerciseEnergyProfileId: computed.exerciseEnergyProfileId,
        exerciseEnergyTimingProfileId: computed.exerciseEnergyTimingProfileId,
        energyCalculationMethod: computed.energyCalculationMethod,
        energyPopulationType: computed.energyPopulationType,
        energyPolicyVersion: computed.energyPolicyVersion,
        energySourceVersion: computed.energySourceVersion,
        energyCalculatedAt: computed.energyCalculatedAt.toISOString(),
      });
    }
    return { ...preview, exercises };
  }

  private async loadVariantEdges(): Promise<VariantEdge[]> {
    const result = await this.db.query<{
      from_key: string; to_key: string; relationType: string; priority: number; levelDelta: number;
    }>(`SELECT f.key AS from_key, t.key AS to_key, vr."relationType", vr.priority, vr."levelDelta"
        FROM "ExerciseVariantRelation" vr
        JOIN "Exercise" f ON f.id = vr."fromExerciseId"
        JOIN "Exercise" t ON t.id = vr."toExerciseId"
        WHERE vr.active = true`);
    return result.rows
      .filter((row) => Boolean(row.from_key && row.to_key))
      .map((row) => ({ fromKey: row.from_key, toKey: row.to_key, relationType: row.relationType, priority: row.priority, levelDelta: row.levelDelta }));
  }

  private async lockSession(query: SqlQuery, sessionId: string): Promise<void> {
    await query('SELECT pg_advisory_xact_lock($1, hashtext($2::text))', [
      WORKOUT_ADAPTATION_LOCK_NAMESPACE,
      sessionId,
    ]);
  }

  private async requireActiveSession(userId: string, sessionId: string) {
    const session = await this.sessions.findByIdForUser(userId, sessionId);
    if (!session) throw new Error('WORKOUT_SESSION_NOT_FOUND');
    this.assertActiveStatus(session.status);
    return session;
  }

  private assertActiveStatus(status: string): void {
    if (status === 'COMPLETED') throw new Error('WORKOUT_SESSION_COMPLETED');
    if (status === 'ABANDONED') throw new Error('WORKOUT_SESSION_ABANDONED');
  }

  private assertIntent(intent: unknown): asserts intent is WorkoutAdaptationIntent {
    if (!WORKOUT_ADAPTATION_INTENTS.includes(intent as WorkoutAdaptationIntent)) {
      throw new Error('WORKOUT_ADAPTATION_INTENT_INVALID');
    }
  }
}

function moveDate(date: string, fromDayIndex: number, toDayIndex: number): string {
  const delta = (toDayIndex - fromDayIndex + 7) % 7;
  if (delta === 0) throw new Error('WORKOUT_MOVE_DATE_CONFLICT');
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('WORKOUT_MOVE_DATE_CONFLICT');
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return parsed.toISOString().slice(0, 10);
}

export { dateOnlyInTimeZone, dayIndexInTimeZone, normalizeTimeZone };
