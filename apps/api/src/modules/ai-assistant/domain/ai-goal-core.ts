/**
 * Goal Core — personalization anchor for every allowed AI turn.
 */

export type GoalCore = {
  primaryGoal: string | null;
  currentWeight: number | null;
  targetWeight: number | null;
  targetDate: string | null;
  activityLevel: string | null;
  trainingLevel: string | null;
  workoutsPerWeek: number | null;
  dietaryPreferences: string[] | null;
  restrictions: string[] | null;
  availableEquipment: string[] | null;
};

export type GoalCoreSources = {
  profile?: {
    weightKg?: number | null;
    activityLevel?: string | null;
    trainingLevel?: string | null;
    workoutsPerWeek?: number | null;
    dietaryPreferences?: string[] | null;
    foodRestrictions?: string[] | null;
    availableEquipment?: string[] | null;
  } | null;
  goal?: {
    kind?: string | null;
    target?: number | null;
    unit?: string | null;
    targetDate?: string | null;
  } | null;
  progress?: { latestWeightKg?: number | null } | null;
  workout?: { days?: Array<{ dayIndex?: number }> | null } | null;
};

export type GoalPaceStatus = 'ON_TRACK' | 'AGGRESSIVE' | 'CONFLICTING' | 'INSUFFICIENT_DATA';

export type GoalPaceAssessment = {
  status: GoalPaceStatus;
  requiredChangePerWeek: number | null;
  weeksUntilTarget: number | null;
  cautionKgPerWeek: number;
};

export function goalWeightChangeCautionKgPerWeek(): number {
  const raw = Number(process.env.GOAL_WEIGHT_CHANGE_CAUTION_KG_PER_WEEK ?? '1');
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function buildGoalCore(sources: GoalCoreSources): GoalCore {
  const currentWeight =
    typeof sources.progress?.latestWeightKg === 'number'
      ? sources.progress.latestWeightKg
      : typeof sources.profile?.weightKg === 'number'
        ? sources.profile.weightKg
        : null;

  const targetWeight =
    sources.goal?.unit === 'kg' && typeof sources.goal.target === 'number' ? sources.goal.target : null;

  const workoutDays = sources.workout?.days?.length;
  const derivedWorkouts =
    typeof sources.profile?.workoutsPerWeek === 'number'
      ? sources.profile.workoutsPerWeek
      : typeof workoutDays === 'number' && workoutDays > 0
        ? Math.min(workoutDays, 7)
        : null;

  return {
    primaryGoal: sources.goal?.kind ? String(sources.goal.kind) : null,
    currentWeight,
    targetWeight,
    targetDate: sources.goal?.targetDate ? String(sources.goal.targetDate) : null,
    activityLevel: sources.profile?.activityLevel ? String(sources.profile.activityLevel) : null,
    trainingLevel: sources.profile?.trainingLevel ? String(sources.profile.trainingLevel) : null,
    workoutsPerWeek: derivedWorkouts,
    dietaryPreferences: sources.profile?.dietaryPreferences ?? null,
    restrictions: sources.profile?.foodRestrictions ?? null,
    availableEquipment: sources.profile?.availableEquipment ?? null,
  };
}

/** Pace-based goal assessment (replaces fixed 8 kg absolute delta). */
export function assessGoalPace(goal: GoalCore, now = new Date()): GoalPaceAssessment {
  const cautionKgPerWeek = goalWeightChangeCautionKgPerWeek();
  if (goal.currentWeight == null || goal.targetWeight == null) {
    return { status: 'INSUFFICIENT_DATA', requiredChangePerWeek: null, weeksUntilTarget: null, cautionKgPerWeek };
  }

  const delta = goal.targetWeight - goal.currentWeight;
  if (goal.primaryGoal === 'lose_weight' && delta > 0) {
    return { status: 'CONFLICTING', requiredChangePerWeek: null, weeksUntilTarget: null, cautionKgPerWeek };
  }
  if (goal.primaryGoal === 'gain_muscle' && delta < 0) {
    return { status: 'CONFLICTING', requiredChangePerWeek: null, weeksUntilTarget: null, cautionKgPerWeek };
  }

  if (!goal.targetDate) {
    return { status: 'INSUFFICIENT_DATA', requiredChangePerWeek: null, weeksUntilTarget: null, cautionKgPerWeek };
  }

  const target = new Date(goal.targetDate);
  if (Number.isNaN(target.getTime())) {
    return { status: 'INSUFFICIENT_DATA', requiredChangePerWeek: null, weeksUntilTarget: null, cautionKgPerWeek };
  }

  const daysUntilTarget = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilTarget <= 0) {
    return { status: 'AGGRESSIVE', requiredChangePerWeek: null, weeksUntilTarget: 0, cautionKgPerWeek };
  }

  const weeksUntilTarget = daysUntilTarget / 7;
  const requiredChangePerWeek = Math.abs(goal.currentWeight - goal.targetWeight) / weeksUntilTarget;
  const status: GoalPaceStatus =
    requiredChangePerWeek > cautionKgPerWeek ? 'AGGRESSIVE' : 'ON_TRACK';

  return { status, requiredChangePerWeek, weeksUntilTarget, cautionKgPerWeek };
}

/** @deprecated use assessGoalPace — kept for transitional call sites */
export function isAggressiveWeightGoal(goal: GoalCore): boolean {
  return assessGoalPace(goal).status === 'AGGRESSIVE';
}
