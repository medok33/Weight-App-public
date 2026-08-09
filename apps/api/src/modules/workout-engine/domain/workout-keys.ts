export const WORKOUT_KEYS = [
  'morning_walk',
  'bodyweight_squats',
  'stretching',
  'light_jog',
  'core_plank',
  'mobility_flow',
  'recovery_walk',
] as const;

export type WorkoutKey = (typeof WORKOUT_KEYS)[number];

const LEGACY_WORKOUT_NAMES: Record<string, WorkoutKey> = {
  'Morning walk': 'morning_walk',
  'Bodyweight squats': 'bodyweight_squats',
  Stretching: 'stretching',
  'Light jog': 'light_jog',
  'Core plank': 'core_plank',
  'Mobility flow': 'mobility_flow',
  'Recovery walk': 'recovery_walk',
  Exercise: 'morning_walk',
};

export function normalizeWorkoutKey(name: string): string {
  return LEGACY_WORKOUT_NAMES[name] ?? name;
}
