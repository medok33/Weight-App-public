import { assessGoalPace, buildGoalCore, type GoalCoreSources } from '../../ai-assistant/domain/ai-goal-core';
import { targetEtaWeeks } from '../../nutrition-engine/domain/nutrition-engine.policy';
import type { GoalImpactDto } from './substitution.types';

const MSG_SHIFT =
  'Если регулярно сохранять такое изменение и не корректировать остальной рацион или активность, расчётный срок может сдвинуться.';
const MSG_INSUFFICIENT = 'Недостаточно данных для прогноза срока — не выдумываем дату.';
const MSG_OK = 'При сохранении текущего остального рациона расчётный темп существенно не меняется.';

/**
 * Uses existing Goal Core / nutrition ETA — no second forecast engine.
 * Does not invent exact weight change promises.
 */
export function assessSubstitutionGoalImpact(input: {
  sources: GoalCoreSources;
  dayCalorieDelta: number;
  weekCalorieDelta: number;
  now?: Date;
}): GoalImpactDto {
  const goal = buildGoalCore(input.sources);
  const pace = assessGoalPace(goal, input.now);

  if (pace.status === 'INSUFFICIENT_DATA' || goal.currentWeight == null || goal.targetWeight == null) {
    return {
      status: 'INSUFFICIENT_DATA',
      dayCalorieDelta: input.dayCalorieDelta,
      weekCalorieDelta: input.weekCalorieDelta,
      projectedPaceKgPerWeek: null,
      etaWeeksBefore: null,
      etaWeeksAfter: null,
      etaChanged: false,
      message: MSG_INSUFFICIENT,
      confidence: 'insufficient',
    };
  }

  let etaWeeksBefore: number | null = null;
  let etaWeeksAfter: number | null = null;
  try {
    if (goal.currentWeight > goal.targetWeight) {
      etaWeeksBefore = targetEtaWeeks(goal.currentWeight, goal.targetWeight, 0.5);
      // Approximate: 7700 kcal ≈ 1 kg; week delta shifts effective pace.
      const basePace = 0.5;
      const kgFromWeekDelta = input.weekCalorieDelta / 7700;
      const adjustedPace = Math.max(0.05, basePace - kgFromWeekDelta);
      etaWeeksAfter = targetEtaWeeks(goal.currentWeight, goal.targetWeight, adjustedPace);
    }
  } catch {
    etaWeeksBefore = pace.weeksUntilTarget;
    etaWeeksAfter = pace.weeksUntilTarget;
  }

  const etaChanged =
    etaWeeksBefore != null && etaWeeksAfter != null && Math.abs(etaWeeksAfter - etaWeeksBefore) >= 1;
  const significantCal = Math.abs(input.weekCalorieDelta) >= 700;

  let status: GoalImpactDto['status'] = pace.status;
  let message = MSG_OK;
  if (etaChanged || significantCal) {
    status = 'SHIFTED';
    message = MSG_SHIFT;
  }

  return {
    status,
    dayCalorieDelta: round1(input.dayCalorieDelta),
    weekCalorieDelta: round1(input.weekCalorieDelta),
    projectedPaceKgPerWeek: pace.requiredChangePerWeek,
    etaWeeksBefore,
    etaWeeksAfter,
    etaChanged,
    message,
    confidence: etaWeeksBefore != null ? 'medium' : 'low',
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
