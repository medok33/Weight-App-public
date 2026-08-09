export type WorkoutSessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
export type WorkoutSessionExerciseStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

export type WorkoutSessionMediaSnapshot = {
  id: string;
  mediaType: string;
  role: string;
  locale: string | null;
  altText: string;
  sortOrder: number;
};

export type WorkoutSessionSetView = {
  id: string;
  setIndex: number;
  targetReps: number | null;
  targetDurationSeconds: number | null;
  actualReps: number | null;
  actualDurationSeconds: number | null;
  weightKg: number | null;
  completedAt: string | null;
};

export type WorkoutSessionExerciseView = {
  id: string;
  orderIndex: number;
  exerciseKey: string | null;
  sourceExerciseId: string | null;
  exerciseRevisionId: string | null;
  catalogReleaseId: string | null;
  displayNameRu: string;
  displayNameEn: string;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationSeconds: number | null;
  restSeconds: number | null;
  techniqueSummaryRu: string | null;
  techniqueSummaryEn: string | null;
  commonMistakeRu: string | null;
  commonMistakeEn: string | null;
  easierVariantRu: string | null;
  easierVariantEn: string | null;
  breathingRu: string | null;
  breathingEn: string | null;
  stopConditionsRu: string | null;
  stopConditionsEn: string | null;
  media: WorkoutSessionMediaSnapshot[];
  status: WorkoutSessionExerciseStatus;
  skippedAt: string | null;
  completedAt: string | null;
  sets: WorkoutSessionSetView[];
};

export type WorkoutSessionView = {
  id: string;
  userId: string;
  workoutPlanId: string | null;
  sourceDayIndex: number;
  effectiveDayIndex: number;
  effectiveDate: string;
  dayTitle: string | null;
  estimatedMinutes: number | null;
  version: number;
  status: WorkoutSessionStatus;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  abandonedAt: string | null;
  durationSeconds: number | null;
  totalExercises: number;
  completedExercises: number;
  exercises: WorkoutSessionExerciseView[];
};

export type WorkoutSessionSetPatch = {
  completed?: boolean;
  actualReps?: number | null;
  actualDurationSeconds?: number | null;
  weightKg?: number | null;
};

export type WorkoutSessionStartInput = {
  dayIndex?: number;
  date?: string;
};

export type WorkoutSessionCompleteInput = {
  confirmIncomplete?: boolean;
};

export class WorkoutActiveSessionConflictError extends Error {
  readonly activeSessionId: string;

  constructor(activeSessionId: string) {
    super('WORKOUT_ACTIVE_SESSION_EXISTS');
    this.name = 'WorkoutActiveSessionConflictError';
    this.activeSessionId = activeSessionId;
  }
}

export class WorkoutSessionIncompleteError extends Error {
  readonly incompleteExercises: number;
  readonly completedExercises: number;
  readonly skippedExercises: number;
  readonly totalExercises: number;

  constructor(counts: {
    incompleteExercises: number;
    completedExercises: number;
    skippedExercises: number;
    totalExercises: number;
  }) {
    super('WORKOUT_SESSION_INCOMPLETE');
    this.name = 'WorkoutSessionIncompleteError';
    this.incompleteExercises = counts.incompleteExercises;
    this.completedExercises = counts.completedExercises;
    this.skippedExercises = counts.skippedExercises;
    this.totalExercises = counts.totalExercises;
  }
}
