/**
 * Canonical visual profile registry for WORKOUT-CATALOG-01C-A exercise media.
 * Single source for character / style / outfit / background / prompt version keys.
 */

export const EXERCISE_MEDIA_VISUAL_PROFILES = {
  characterProfileKey: "weight-female-v1",
  visualStyleKey: "calm-premium-v1",
  outfitProfileKey: "forest-graphite-v1",
  backgroundProfileKey: "warm-studio-v1",
  promptVersion: "exercise-media-v1",
} as const;

export type ExerciseMediaVisualProfiles = typeof EXERCISE_MEDIA_VISUAL_PROFILES;

export const EXERCISE_MEDIA_VISUAL_PROFILE_KEYS = [
  EXERCISE_MEDIA_VISUAL_PROFILES.characterProfileKey,
  EXERCISE_MEDIA_VISUAL_PROFILES.visualStyleKey,
  EXERCISE_MEDIA_VISUAL_PROFILES.outfitProfileKey,
  EXERCISE_MEDIA_VISUAL_PROFILES.backgroundProfileKey,
  EXERCISE_MEDIA_VISUAL_PROFILES.promptVersion,
] as const;
