export const WORKOUT_ADAPTATION_POLICY_VERSION = "workout-adaptation-01d.1" as const;

export const WORKOUT_ADAPTATION_INTENTS = [
  "HOME",
  "SHORTER",
  "LIGHTER",
  "WALK_RECOVERY",
  "MOVE_DAY",
] as const;

export type WorkoutAdaptationIntent = (typeof WORKOUT_ADAPTATION_INTENTS)[number];

export const WORKOUT_ADAPTATION_INTENT_LABELS_RU: Record<WorkoutAdaptationIntent, string> = {
  HOME: "Провести дома",
  SHORTER: "Сделать короче",
  LIGHTER: "Сделать легче",
  WALK_RECOVERY: "Прогулка или восстановление",
  MOVE_DAY: "Перенести на другой день",
};

export type WorkoutAdaptationStatus = "APPLIED" | "UNDONE";
export type WorkoutAdaptationCommandAction = "APPLY" | "UNDO";

export type GoalImpactCategory =
  | "GOAL_PRESERVED"
  | "MOSTLY_PRESERVED"
  | "RECOVERY_PRIORITY"
  | "SCHEDULE_ONLY"
  | "NOTICEABLE_REDUCTION";

export type GoalImpactSnapshot = {
  policyVersion: typeof WORKOUT_ADAPTATION_POLICY_VERSION;
  impactCategory: GoalImpactCategory;
  trainingStimulus: "unchanged" | "slightly_lower" | "lower" | "recovery";
  durationChange: "unchanged" | "slightly_shorter" | "shorter" | "longer";
  recoveryEffect: "unchanged" | "slightly_higher" | "higher";
  weeklyConsistency: "preserved" | "adjusted";
  summaryRu: string;
  detailsRu: string[];
  disclaimerRu: string;
};

export type AdaptationExerciseSnapshot = {
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
  media: unknown[];
  /** Planned energy snapshot fields — preserved across adaptation replace/undo. */
  energyEstimateStatus?: string | null;
  plannedGrossEstimatedKcal?: number | null;
  plannedRestingEstimatedKcal?: number | null;
  plannedIncrementalEstimatedKcal?: number | null;
  energyWeightKgUsed?: number | null;
  energyWeightSource?: string | null;
  energyWeightSourceRecordedAt?: string | null;
  energyActiveSecondsUsed?: number | null;
  exerciseEnergyProfileId?: string | null;
  exerciseEnergyTimingProfileId?: string | null;
  energyCalculationMethod?: string | null;
  energyPopulationType?: string | null;
  energyPolicyVersion?: string | null;
  energySourceVersion?: string | null;
  energyCalculatedAt?: string | null;
};

export type AdaptationSessionSnapshot = {
  id: string;
  workoutPlanId: string | null;
  sourceDayIndex: number;
  effectiveDayIndex: number;
  effectiveDate: string;
  dayTitle: string | null;
  estimatedMinutes: number | null;
  version: number;
  catalogReleaseId: string | null;
  stateHash?: string;
  exercises: AdaptationExerciseSnapshot[];
};

export type AdaptationOption = {
  optionCode: string;
  recommended: boolean;
  titleRu: string;
  summaryRu: string;
  optionFingerprint: string;
  estimatedMinutesBefore: { min: number; max: number };
  estimatedMinutesAfter: { min: number; max: number };
  estimatedMinutesSaved?: { min: number; max: number };
  moveTargetDayIndex?: number;
  moveTargetDate?: string;
  goalImpact: GoalImpactSnapshot;
  preview: AdaptationSessionSnapshot;
};

export type AdaptationPreview = {
  intent: WorkoutAdaptationIntent;
  intentLabelRu: string;
  policyVersion: typeof WORKOUT_ADAPTATION_POLICY_VERSION;
  sessionId: string;
  sessionVersion: number;
  catalogReleaseId: string | null;
  timeZone: string;
  recommended: AdaptationOption | null;
  alternatives: AdaptationOption[];
  unavailableReasonRu: string | null;
};

export type WorkoutAdaptationRecord = {
  id: string;
  userId: string;
  workoutPlanId: string | null;
  workoutSessionId: string;
  intent: WorkoutAdaptationIntent;
  selectedOptionCode: string;
  policyVersion: string;
  catalogReleaseId: string | null;
  sessionVersionBefore: number;
  sessionVersionAfter: number;
  beforeSnapshot: AdaptationSessionSnapshot;
  afterSnapshot: AdaptationSessionSnapshot;
  goalImpactSnapshot: GoalImpactSnapshot;
  status: WorkoutAdaptationStatus;
  idempotencyKey: string | null;
  createdAt: string;
  undoneAt: string | null;
};

export type AdaptationApplyResult = {
  adaptation: WorkoutAdaptationRecord;
  session: AdaptationSessionSnapshot;
  idempotentReplay: boolean;
};

export type WorkoutAdaptationCommandRecord = {
  id: string;
  userId: string;
  workoutSessionId: string;
  action: WorkoutAdaptationCommandAction;
  idempotencyKey: string;
  requestHash: string;
  adaptationId: string | null;
  responseSnapshot: AdaptationApplyResult;
  createdAt: string;
};

/** Namespace for session-scoped adaptation advisory xact locks. */
export const WORKOUT_ADAPTATION_LOCK_NAMESPACE = 212_001_01;

/** @deprecated use WORKOUT_ADAPTATION_LOCK_NAMESPACE + session hash */
export const WORKOUT_ADAPTATION_LOCK_KEY = WORKOUT_ADAPTATION_LOCK_NAMESPACE;

export const WORKOUT_ADAPTATION_HISTORY_DEFAULT_LIMIT = 50;
export const WORKOUT_ADAPTATION_HISTORY_MAX_LIMIT = 100;

export const GOAL_IMPACT_DISCLAIMER_RU =
  "Оценка приблизительная и не является медицинским или физиологическим прогнозом.";
