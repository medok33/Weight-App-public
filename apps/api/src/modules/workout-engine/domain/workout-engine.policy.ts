import type { Exercise, WorkoutPlan } from './workout-engine.types';
export function validateExercise(exercise: Exercise): Exercise { if (!exercise.name.trim()) throw new Error('EXERCISE_INVALID'); return { ...exercise, safetyTags: [...new Set(exercise.safetyTags ?? [])], substitutions: [...new Set(exercise.substitutions ?? [])] }; }
export function safeExerciseForTags(exercise: Exercise, blockedTags: string[]) { return !exercise.safetyTags?.some((tag) => blockedTags.includes(tag)); }
export function buildWorkoutPlan(exercises: Exercise[], blockedTags: string[] = []): WorkoutPlan { const safe = exercises.filter((e) => safeExerciseForTags(e, blockedTags)).slice(0, 7); return { days: safe.map((exercise, dayIndex) => ({ dayIndex, exercises: [exercise] })) }; }
