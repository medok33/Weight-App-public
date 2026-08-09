import type { MessageKey } from '../../../i18n/types';
import type { WorkoutAdaptationIntent, WorkoutReplacementType } from './workout-engine.types';

/** Max primary change options shown without grouping (01E). */
export const CHANGE_TODAY_MAX_VISIBLE = 3;

export type ChangeTodayOption = {
  id: string;
  kind: 'replacement' | 'adaptation';
  replacementType?: WorkoutReplacementType;
  adaptationIntent?: WorkoutAdaptationIntent;
  moveTargetDayIndex?: number;
  titleKey: MessageKey;
  summaryKey: MessageKey;
};

/**
 * Build human Change-today options from replacement catalog + stable adaptation intents.
 * Prefer replacements (no accidental session start). Cap visible list.
 * When adaptation is allowed, reserve one slot so it remains reachable.
 */
export function buildChangeTodayOptions(input: {
  replacements: Array<{
    type: WorkoutReplacementType;
    moveTargetDayIndex?: number;
  }>;
  allowAdaptation: boolean;
}): ChangeTodayOption[] {
  const out: ChangeTodayOption[] = [];
  const replacementCap = input.allowAdaptation
    ? Math.max(0, CHANGE_TODAY_MAX_VISIBLE - 1)
    : CHANGE_TODAY_MAX_VISIBLE;

  const order: WorkoutReplacementType[] = [
    'MOVE_DAY',
    'HOME_SHORT',
    'LIGHTER',
    'WALK',
    'RECOVERY',
  ];

  for (const type of order) {
    if (out.length >= replacementCap) break;
    const match = input.replacements.find((item) => item.type === type);
    if (!match) continue;
    out.push({
      id: `replacement:${type}`,
      kind: 'replacement',
      replacementType: type,
      moveTargetDayIndex: match.moveTargetDayIndex,
      titleKey: `workout.changeToday.option.${type}.title` as MessageKey,
      summaryKey: `workout.changeToday.option.${type}.summary` as MessageKey,
    });
  }

  if (input.allowAdaptation && out.length < CHANGE_TODAY_MAX_VISIBLE) {
    out.push({
      id: 'adaptation:HOME',
      kind: 'adaptation',
      adaptationIntent: 'HOME',
      titleKey: 'workout.changeToday.option.adaptHome.title',
      summaryKey: 'workout.changeToday.option.adaptHome.summary',
    });
  }

  return out.slice(0, CHANGE_TODAY_MAX_VISIBLE);
}
