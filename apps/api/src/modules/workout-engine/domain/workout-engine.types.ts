export type RiskLevel = 'low' | 'medium' | 'high';
export type TrainingLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type MovementPattern = 'squat' | 'hinge' | 'push' | 'pull' | 'core' | 'cardio' | 'mobility';
export type TrainingPlace = 'HOME' | 'GYM' | 'MIXED';
export type PreferredDuration = 'SHORT' | 'STANDARD' | 'LONG';
export type ExerciseRepetitionMode = 'REPS' | 'DURATION' | 'REPS_OR_DURATION';
export type WorkoutPrescriptionMode = 'REPS' | 'DURATION';
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

/** Legacy exercise shape used by build()/register(). */
export type Exercise = {
  name: string;
  riskLevel: RiskLevel;
  safetyTags?: string[];
  substitutions?: string[];
};

export type CatalogExercise = {
  id?: string;
  key: string;
  name: string;
  nameRu?: string | null;
  nameEn?: string | null;
  displayNameRu?: string | null;
  displayNameEn?: string | null;
  /** Versioned technique from pinned ExerciseRevision (no hub fallback). */
  techniqueSummaryRu?: string | null;
  techniqueSummaryEn?: string | null;
  commonMistakeRu?: string | null;
  commonMistakeEn?: string | null;
  /** Text guidance for simplifying the current movement (not a related exercise name). */
  easierVariantRu?: string | null;
  easierVariantEn?: string | null;
  breathingRu?: string | null;
  breathingEn?: string | null;
  stopConditionsRu?: string | null;
  stopConditionsEn?: string | null;
  /** Identity/filter hub only — candidate graph key, not user-facing easier text. */
  easierVariantKey?: string | null;
  estimatedMinutes?: number | null;
  riskLevel: RiskLevel;
  movementPattern: MovementPattern;
  difficulty: TrainingLevel;
  equipmentCodes: string[];
  muscleGroups?: string[];
  isActive?: boolean;
  /** Pinned catalog revision id when loaded from a PUBLISHED release. */
  exerciseRevisionId?: string | null;
  repetitionMode?: ExerciseRepetitionMode | null;
  /** Catalog default set count; DURATION energy requires 1 (whole-exercise interval). */
  defaultSets?: number | null;
  defaultDurationSeconds?: number | null;
  defaultRepsMin?: number | null;
  defaultRepsMax?: number | null;
};

export type WorkoutPlanDayExercise = {
  exerciseOrder: number;
  exerciseName: string;
  exerciseKey?: string;
  exerciseId?: string | null;
  /** WorkoutPlanDay.id for the source plan row (provenance). */
  planDayRowId?: string | null;
  riskLevel: RiskLevel;
  sets?: number | null;
  repsMin?: number | null;
  repsMax?: number | null;
  restSeconds?: number | null;
  prescriptionMode?: WorkoutPrescriptionMode | null;
  durationSecondsPerSet?: number | null;
};

export type WorkoutPlanDayDetail = {
  dayIndex: number;
  /**
   * Original plan day before MOVE_DAY. When unset, equals dayIndex.
   * After MOVE_DAY onto a target day, sourceDayIndex keeps the pre-move day.
   */
  sourceDayIndex?: number;
  dayTitle?: string | null;
  isRestDay: boolean;
  trainingPlace?: Exclude<TrainingPlace, 'MIXED'>;
  estimatedMinutes?: number;
  exercises: WorkoutPlanDayExercise[];
};

export type WorkoutPlanDetail = {
  days: WorkoutPlanDayDetail[];
};

/** Legacy weekly plan shape (one exercise list per day). */
export type WorkoutPlan = { days: { dayIndex: number; exercises: Exercise[] }[] };

export type WorkoutPlanGenerateInput = {
  goalKind: string;
  trainingLevel: TrainingLevel;
  trainingPlace?: TrainingPlace;
  workoutsPerWeek: number;
  preferredDuration?: PreferredDuration;
  availableDays?: number[];
  equipmentCodes: string[];
  preferredActivityTypes?: string[];
  excludedKeys: string[];
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
  createdAt?: Date;
  updatedAt?: Date;
};

export type WorkoutProfilePatch = Partial<
  Omit<WorkoutProfile, 'userId' | 'createdAt' | 'updatedAt'>
>;

export type WorkoutReplacementType = 'HOME_SHORT' | 'WALK' | 'RECOVERY' | 'MOVE_DAY' | 'LIGHTER';

export type WorkoutPlanDayOverride = {
  id: string;
  userId: string;
  workoutPlanId: string;
  dayIndex: number;
  replacementType: WorkoutReplacementType;
  replacementDayTitle: string | null;
  replacementSnapshot: WorkoutPlanDayDetail;
  moveTargetDayIndex: number | null;
  reason: string | null;
  source: 'user' | 'system';
  status: 'active' | 'reverted';
  createdAt: Date;
  revertedAt: Date | null;
};

export type WorkoutPlanSaveMeta = {
  status?: string;
  algorithmVersion: string;
  inputSnapshotJson: unknown;
  generatedAt?: Date;
  workoutCatalogReleaseId?: string | null;
  workoutCatalogReleaseCode?: string | null;
  /** IANA timezone snapshot from UserProfile.timezone (UTC fallback). */
  timeZone?: string | null;
};

export type WorkoutSetupStatus = {
  ready: boolean;
  missing: string[];
  trainingLevel: TrainingLevel | null;
  workoutsPerWeek: number | null;
  goalKind: string | null;
  equipmentCodes: string[];
  profile?: WorkoutProfile | null;
};

export type StoredWorkoutPlan = {
  id: string;
  version: number;
  status?: string;
  algorithmVersion?: string;
  plan: WorkoutPlanDetail;
};
