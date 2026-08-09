export type WorkoutSummaryDay = {
  dayIndex: number;
  exerciseOrder: number;
  exerciseName: string;
  exerciseKey?: string;
  exerciseId?: string | null;
  dayTitle?: string | null;
  isRestDay?: boolean;
  sets?: number | null;
  repsMin?: number | null;
  repsMax?: number | null;
  restSeconds?: number | null;
  riskLevel?: string;
};

export type TrainingLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type TrainingPlace = 'HOME' | 'GYM' | 'MIXED';
export type PreferredDuration = 'SHORT' | 'STANDARD' | 'LONG';
export type WorkoutEquipmentCode =
  | 'NONE'
  | 'BODYWEIGHT'
  | 'RESISTANCE_BAND'
  | 'DUMBBELL'
  | 'KETTLEBELL'
  | 'BENCH'
  | 'PULLUP_BAR'
  | 'GYM_MACHINES'
  | 'BARBELL'
  | 'CARDIO_MACHINE';

export type WorkoutPlanExercise = {
  exerciseOrder: number;
  exerciseName: string;
  exerciseKey?: string;
  exerciseId?: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  sets?: number | null;
  repsMin?: number | null;
  repsMax?: number | null;
  restSeconds?: number | null;
  prescriptionMode?: 'REPS' | 'DURATION' | null;
  durationSecondsPerSet?: number | null;
};

export type WorkoutPlanDay = {
  dayIndex: number;
  dayTitle?: string | null;
  isRestDay: boolean;
  trainingPlace?: Exclude<TrainingPlace, 'MIXED'>;
  estimatedMinutes?: number;
  estimatedKcalMin?: number;
  estimatedKcalMax?: number;
  exercises: WorkoutPlanExercise[];
};

export type WorkoutSummary = {
  userId: string;
  version: number;
  planId?: string;
  algorithmVersion?: string;
  status?: string;
  days: WorkoutSummaryDay[];
};

export type WorkoutWeek = {
  userId: string;
  version: number;
  planId?: string;
  algorithmVersion?: string;
  days: WorkoutPlanDay[];
};

export type WorkoutToday = WorkoutWeek & {
  dayIndex: number;
  day: WorkoutPlanDay | null;
  /** Additive 01E hub field — latest session for today when present. */
  todaySession?: {
    id: string;
    status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
    completedExercises?: number | null;
    totalExercises?: number | null;
    durationSeconds?: number | null;
  } | null;
};

export type WorkoutProfile = {
  userId: string;
  trainingLevel: TrainingLevel;
  trainingPlace: TrainingPlace;
  workoutsPerWeek: number;
  preferredDuration: PreferredDuration;
  availableDays: number[];
  workoutEquipment: WorkoutEquipmentCode[];
  preferredActivityTypes: string[];
  excludedExerciseKeys: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type WorkoutProfilePatch = Partial<
  Omit<WorkoutProfile, 'userId' | 'createdAt' | 'updatedAt'>
>;

export type WorkoutSetupStatus = {
  ready: boolean;
  missing: string[];
  trainingLevel: TrainingLevel | null;
  workoutsPerWeek: number | null;
  goalKind: string | null;
  equipmentCodes: string[];
  profile?: WorkoutProfile | null;
};

export type WorkoutReplacementType =
  | 'HOME_SHORT'
  | 'WALK'
  | 'RECOVERY'
  | 'MOVE_DAY'
  | 'LIGHTER';

export type WorkoutReplacementOption = {
  type: WorkoutReplacementType;
  titleRu?: string;
  moveTargetDayIndex?: number;
};

export type WorkoutPlanDayOverride = {
  id: string;
  userId: string;
  workoutPlanId: string;
  dayIndex: number;
  replacementType: WorkoutReplacementType;
  replacementDayTitle: string | null;
  replacementSnapshot: WorkoutPlanDay;
  moveTargetDayIndex: number | null;
  status: 'active' | 'reverted';
  createdAt: string;
  revertedAt: string | null;
};

export type ExerciseMedia = {
  id: string;
  mediaType: string;
  role: string;
  storageKey?: string | null;
  mediaAssetId?: string | null;
  locale?: string | null;
  altText?: string | null;
};

export type WorkoutExerciseDetail = {
  id: string;
  key: string;
  name: string;
  nameRu?: string | null;
  nameEn?: string | null;
  displayNameRu?: string | null;
  displayNameEn?: string | null;
  techniqueSummaryRu?: string | null;
  techniqueSummaryEn?: string | null;
  commonMistakeRu?: string | null;
  commonMistakeEn?: string | null;
  easierVariantKey?: string | null;
  estimatedMinutes?: number | null;
  riskLevel: 'low' | 'medium' | 'high';
  movementPattern: string;
  difficulty: TrainingLevel;
  equipmentCodesJson?: unknown;
  muscleGroupsJson?: unknown;
  media: ExerciseMedia[];
};

export type WorkoutDayGroup = {
  dayIndex: number;
  dayTitle: string | null;
  isRestDay: boolean;
  exercises: WorkoutSummaryDay[];
};

export type WorkoutSessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
export type WorkoutSessionExerciseStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

export type WorkoutSessionMedia = {
  id: string;
  mediaType: string;
  role: string;
  locale: string | null;
  altText: string;
  sortOrder: number;
};

export type WorkoutSessionSet = {
  id: string;
  setIndex: number;
  targetReps: number | null;
  targetDurationSeconds: number | null;
  actualReps: number | null;
  actualDurationSeconds: number | null;
  weightKg: number | null;
  completedAt: string | null;
};

export type WorkoutSessionExercise = {
  id: string;
  orderIndex: number;
  exerciseKey: string | null;
  sourceExerciseId: string | null;
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
  media: WorkoutSessionMedia[];
  status: WorkoutSessionExerciseStatus;
  skippedAt: string | null;
  completedAt: string | null;
  sets: WorkoutSessionSet[];
};

export type WorkoutSession = {
  id: string;
  userId: string;
  workoutPlanId: string | null;
  sourceDayIndex: number;
  effectiveDayIndex: number;
  effectiveDate: string;
  dayTitle: string | null;
  estimatedMinutes: number | null;
  status: WorkoutSessionStatus;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  abandonedAt: string | null;
  durationSeconds: number | null;
  totalExercises: number;
  completedExercises: number;
  exercises: WorkoutSessionExercise[];
};

export type WorkoutSessionSetPatch = {
  completed?: boolean;
  actualReps?: number | null;
  actualDurationSeconds?: number | null;
  weightKg?: number | null;
};

export type WorkoutAdaptationIntent =
  | 'HOME'
  | 'SHORTER'
  | 'LIGHTER'
  | 'WALK_RECOVERY'
  | 'MOVE_DAY';

export type WorkoutGoalImpact = {
  policyVersion: string;
  impactCategory: string;
  trainingStimulus: string;
  durationChange: string;
  recoveryEffect: string;
  weeklyConsistency: string;
  summaryRu: string;
  detailsRu: string[];
  disclaimerRu: string;
};

export type WorkoutAdaptationOption = {
  optionCode: string;
  recommended: boolean;
  titleRu: string;
  summaryRu: string;
  optionFingerprint: string;
  estimatedMinutesBefore: { min: number; max: number };
  estimatedMinutesAfter: { min: number; max: number };
  estimatedMinutesSaved?: { min: number; max: number };
  moveTargetDayIndex?: number;
  goalImpact: WorkoutGoalImpact;
  preview?: {
    effectiveDayIndex: number;
    effectiveDate: string;
    exercises: Array<{ exerciseKey: string | null }>;
  };
};

export type WorkoutAdaptationPreview = {
  intent: WorkoutAdaptationIntent;
  intentLabelRu: string;
  policyVersion: string;
  sessionId: string;
  sessionVersion: number;
  catalogReleaseId: string | null;
  timeZone: string;
  recommended: WorkoutAdaptationOption | null;
  alternatives: WorkoutAdaptationOption[];
  unavailableReasonRu: string | null;
};

export type WorkoutAdaptation = {
  id: string;
  workoutSessionId: string;
  intent: WorkoutAdaptationIntent;
  selectedOptionCode: string;
  sessionVersionBefore: number;
  sessionVersionAfter: number;
  status: 'APPLIED' | 'UNDONE';
  goalImpactSnapshot: WorkoutGoalImpact;
  createdAt: string;
  undoneAt: string | null;
};

export type WorkoutAdaptationSessionSnapshot = {
  id: string;
  effectiveDayIndex: number;
  effectiveDate: string;
  dayTitle: string | null;
  estimatedMinutes: number | null;
  version: number;
};

export type WorkoutAdaptationApplyResult = {
  adaptation: WorkoutAdaptation;
  session: WorkoutAdaptationSessionSnapshot;
  idempotentReplay: boolean;
};

export function groupWorkoutDays(days: WorkoutSummaryDay[]): WorkoutDayGroup[] {
  const map = new Map<number, WorkoutDayGroup>();
  for (const row of days) {
    let group = map.get(row.dayIndex);
    if (!group) {
      group = {
        dayIndex: row.dayIndex,
        dayTitle: row.dayTitle ?? null,
        isRestDay: Boolean(row.isRestDay) || row.exerciseName === 'rest',
        exercises: [],
      };
      map.set(row.dayIndex, group);
    }
    if (!group.isRestDay && row.exerciseName !== 'rest') {
      group.exercises.push(row);
    } else if (row.isRestDay || row.exerciseName === 'rest') {
      group.isRestDay = true;
    }
  }
  return [...map.values()].sort((a, b) => a.dayIndex - b.dayIndex);
}
