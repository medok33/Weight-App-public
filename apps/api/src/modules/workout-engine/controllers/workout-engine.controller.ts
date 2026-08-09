import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { RequestUser } from "../../auth/domain/request-user.types";
import { WorkoutEngineService } from "../application/workout-engine.service";
import { WorkoutSessionService } from "../application/workout-session.service";
import { WorkoutAdaptationService } from "../application/workout-adaptation.service";
import {
  parseAdaptationApplyBody,
  parseAdaptationPreviewBody,
  parseAdaptationUndoBody,
  parseHistoryLimit,
  parseSessionIdParam,
} from "../dto/workout-adaptation.request.dto";
import {
  WorkoutActiveSessionConflictError,
  WorkoutSessionIncompleteError,
} from "../domain/workout-session.types";

@Controller("workout-plan")
export class WorkoutEngineController {
  constructor(
    @Inject(WorkoutEngineService) private readonly service: WorkoutEngineService,
    @Inject(WorkoutSessionService) private readonly sessions: WorkoutSessionService,
    @Inject(WorkoutAdaptationService) private readonly adaptations: WorkoutAdaptationService,
  ) {}

  @Get()
  async get(@CurrentUser() user: RequestUser) {
    return this.service.getEffectiveSummary(user.id);
  }

  @Get("profile")
  profile(@CurrentUser() user: RequestUser) {
    return this.service.getOrCreateWorkoutProfile(user.id);
  }

  @Put("profile")
  updateProfile(@CurrentUser() user: RequestUser, @Body() body: Record<string, unknown>) {
    return this.service.updateWorkoutProfile(user.id, body as never);
  }

  @Get("today")
  async today(@CurrentUser() user: RequestUser, @Query("date") date?: string) {
    const view = await this.service.getTodayView(user.id, date);
    const effectiveDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Date().toISOString().slice(0, 10));
    const session = await this.sessions.getLatestForEffectiveDate(user.id, effectiveDate);
    return {
      ...view,
      todaySession: session
        ? {
            id: session.id,
            status: session.status,
            completedExercises: session.completedExercises,
            totalExercises: session.totalExercises,
            durationSeconds: session.durationSeconds,
          }
        : null,
    };
  }

  @Get("week")
  week(@CurrentUser() user: RequestUser) {
    return this.service.getWeekView(user.id);
  }

  @Get("setup")
  async setup(@CurrentUser() user: RequestUser) {
    return this.service.getSetupStatus(user.id);
  }

  @Post("generate")
  async generate(@CurrentUser() user: RequestUser, @Body() body?: { excludedKeys?: unknown }) {
    try {
      const excludedKeys = Array.isArray(body?.excludedKeys)
        ? body!.excludedKeys.map((k) => String(k)).filter(Boolean)
        : [];
      return await this.service.generatePlan(user.id, { excludedKeys });
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Get("days/:dayIndex/replacements")
  replacements(@CurrentUser() user: RequestUser, @Param("dayIndex") dayIndex: string) {
    try {
      return this.service.listReplacementOptions(user.id, Number(dayIndex));
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("days/:dayIndex/replacements")
  applyReplacement(
    @CurrentUser() user: RequestUser,
    @Param("dayIndex") dayIndex: string,
    @Body() body: { replacementType?: string; moveTargetDayIndex?: number },
  ) {
    try {
      return this.service.applyReplacement(user.id, {
        dayIndex: Number(dayIndex),
        replacementType: String(body?.replacementType ?? "") as never,
        moveTargetDayIndex: body?.moveTargetDayIndex,
      });
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("replacements/:id/revert")
  revertReplacement(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    try {
      return this.service.revertReplacement(user.id, id);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Get("exercises/:key")
  async exercise(@CurrentUser() user: RequestUser, @Param("key") key: string) {
    try {
      return await this.service.getExerciseDetail(user.id, key);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("sessions")
  async startSession(
    @CurrentUser() user: RequestUser,
    @Body() body?: { dayIndex?: number; date?: string; userId?: unknown },
  ) {
    try {
      // Client-supplied userId is ignored; authority is CurrentUser only.
      void body?.userId;
      return await this.sessions.start(user.id, {
        dayIndex: body?.dayIndex == null ? undefined : Number(body.dayIndex),
        date: body?.date == null ? undefined : String(body.date),
      });
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Get("sessions/active")
  async activeSession(@CurrentUser() user: RequestUser) {
    try {
      return await this.sessions.getActive(user.id);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Get("sessions/:sessionId")
  async getSession(@CurrentUser() user: RequestUser, @Param("sessionId") sessionId: string) {
    try {
      return await this.sessions.getById(user.id, sessionId);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Get("sessions/:sessionId/adaptations")
  async adaptationHistory(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Query("limit") limit?: string,
  ) {
    try {
      return await this.adaptations.history(user.id, parseSessionIdParam(sessionId), parseHistoryLimit(limit));
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("sessions/:sessionId/adaptations/preview")
  async previewAdaptation(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    try {
      const parsed = parseAdaptationPreviewBody(body);
      return await this.adaptations.preview(user.id, parseSessionIdParam(sessionId), parsed.intent);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("sessions/:sessionId/adaptations/apply")
  async applyAdaptation(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    try {
      const parsed = parseAdaptationApplyBody(body);
      return await this.adaptations.apply(user.id, parseSessionIdParam(sessionId), parsed);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("sessions/:sessionId/adaptations/undo")
  async undoAdaptation(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    try {
      const parsed = parseAdaptationUndoBody(body);
      return await this.adaptations.undo(user.id, parseSessionIdParam(sessionId), parsed);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Put("sessions/:sessionId/exercises/:exerciseId/sets/:setIndex")
  async updateSet(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Param("exerciseId") exerciseId: string,
    @Param("setIndex") setIndex: string,
    @Body()
    body?: {
      completed?: boolean;
      actualReps?: number | null;
      actualDurationSeconds?: number | null;
      weightKg?: number | null;
    },
  ) {
    try {
      return await this.sessions.updateSet(user.id, sessionId, exerciseId, Number(setIndex), {
        completed: body?.completed,
        actualReps: body?.actualReps,
        actualDurationSeconds: body?.actualDurationSeconds,
        weightKg: body?.weightKg,
      });
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("sessions/:sessionId/exercises/:exerciseId/skip")
  async skipExercise(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Param("exerciseId") exerciseId: string,
  ) {
    try {
      return await this.sessions.skipExercise(user.id, sessionId, exerciseId);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("sessions/:sessionId/exercises/:exerciseId/unskip")
  async unskipExercise(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Param("exerciseId") exerciseId: string,
  ) {
    try {
      return await this.sessions.unskipExercise(user.id, sessionId, exerciseId);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("sessions/:sessionId/complete")
  async completeSession(
    @CurrentUser() user: RequestUser,
    @Param("sessionId") sessionId: string,
    @Body() body?: { confirmIncomplete?: boolean; userId?: unknown },
  ) {
    try {
      // Client-supplied userId is ignored; authority is CurrentUser only.
      void body?.userId;
      return await this.sessions.complete(user.id, sessionId, {
        confirmIncomplete: body?.confirmIncomplete === true,
      });
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }

  @Post("sessions/:sessionId/abandon")
  async abandonSession(@CurrentUser() user: RequestUser, @Param("sessionId") sessionId: string) {
    try {
      return await this.sessions.abandon(user.id, sessionId);
    } catch (error) {
      throw mapWorkoutError(error);
    }
  }
}

function mapWorkoutError(error: unknown): Error {
  if (error instanceof WorkoutActiveSessionConflictError) {
    return new ConflictException({
      message: "WORKOUT_ACTIVE_SESSION_EXISTS",
      activeSessionId: error.activeSessionId,
    });
  }
  if (error instanceof WorkoutSessionIncompleteError) {
    return new ConflictException({
      message: "WORKOUT_SESSION_INCOMPLETE",
      code: "WORKOUT_SESSION_INCOMPLETE",
      incompleteExercises: error.incompleteExercises,
      completedExercises: error.completedExercises,
      skippedExercises: error.skippedExercises,
      totalExercises: error.totalExercises,
    });
  }
  const code = error instanceof Error ? error.message : "WORKOUT_PLAN_GENERATE_FAILED";
  if (code === "WORKOUT_SESSION_NOT_FOUND" || code === "WORKOUT_SESSION_EXERCISE_NOT_FOUND") {
    return new NotFoundException(code);
  }
  if (
    code === "WORKOUT_SETUP_INCOMPLETE" ||
    code === "WORKOUT_CATALOG_INSUFFICIENT" ||
    code === "WORKOUT_CATALOG_RELEASE_MISSING" ||
    code === "WORKOUT_CATALOG_RELEASE_EMPTY" ||
    code === "WORKOUT_CATALOG_RELEASE_SERVICE_UNAVAILABLE" ||
    code === "WORKOUT_CATALOG_INTEGRITY_ERROR" ||
    code === "WORKOUT_PLAN_USER_REQUIRED" ||
    code === "WORKOUT_PLAN_NOT_FOUND" ||
    code === "WORKOUT_DAY_NOT_FOUND" ||
    code === "WORKOUT_DAY_IS_REST" ||
    code === "WORKOUT_DATE_INVALID" ||
    code === "WORKOUT_MOVE_TARGET_INVALID" ||
    code === "WORKOUT_MOVE_TARGET_OCCUPIED" ||
    code === "WORKOUT_MOVE_HEAVY_ADJACENT" ||
    code === "WORKOUT_OVERRIDE_NOT_FOUND" ||
    code === "WORKOUT_EXERCISE_NOT_FOUND" ||
    code === "WORKOUT_EXERCISE_NOT_AVAILABLE" ||
    code === "WORKOUT_PROFILE_INVALID" ||
    code === "WORKOUT_SESSION_SET_NOT_FOUND" ||
    code === "WORKOUT_SESSION_ACTUAL_REPS_INVALID" ||
    code === "WORKOUT_SESSION_ACTUAL_DURATION_INVALID" ||
    code === "WORKOUT_SESSION_WEIGHT_INVALID" ||
    code === "WORKOUT_SESSION_COMPLETED" ||
    code === "WORKOUT_SESSION_ABANDONED" ||
    code === "WORKOUT_ADAPTATION_NO_ALTERNATIVES" ||
    code === "WORKOUT_ADAPTATION_UNDO_UNAVAILABLE" ||
    code === "WORKOUT_ADAPTATION_INTENT_INVALID" ||
    code === "WORKOUT_ADAPTATION_REQUEST_INVALID" ||
    code === "WORKOUT_ADAPTATION_UNKNOWN_FIELD" ||
    code === "WORKOUT_ADAPTATION_IDEMPOTENCY_REQUIRED" ||
    code === "WORKOUT_ADAPTATION_IDEMPOTENCY_INVALID" ||
    code === "WORKOUT_TIMEZONE_INVALID" ||
    code === "WORKOUT_MOVE_DATE_CONFLICT" ||
    code === "WORKOUT_EXERCISE_SKIPPED" ||
    code.startsWith("WORKOUT_PROFILE_")
  ) {
    return new BadRequestException(code);
  }
  if (
    code === "WORKOUT_PLAN_GENERATE_IN_PROGRESS" ||
    code === "WORKOUT_SESSION_START_IN_PROGRESS" ||
    code === "WORKOUT_ACTIVE_SESSION_EXISTS" ||
    code === "WORKOUT_SESSION_INCOMPLETE"
    || code === "WORKOUT_ADAPTATION_STALE_VERSION"
    || code === "WORKOUT_ADAPTATION_OPTION_EXPIRED"
    || code === "WORKOUT_ADAPTATION_CATALOG_STALE"
    || code === "WORKOUT_ADAPTATION_IDEMPOTENCY_CONFLICT"
  ) {
    return new ConflictException(code);
  }
  if (/duplicate key|23505/i.test(code)) {
    return new ConflictException("WORKOUT_PLAN_VERSION_CONFLICT");
  }
  return new BadRequestException("WORKOUT_PLAN_GENERATE_FAILED");
}

/** Exported for HTTP error-mapping unit tests. */
export { mapWorkoutError };
