export const EXERCISE_MEDIA_FOUNDATION_ROLES = [
  "START_POSITION",
  "END_POSITION",
  "MUSCLE_MAP",
] as const;

export type ExerciseMediaFoundationRole = (typeof EXERCISE_MEDIA_FOUNDATION_ROLES)[number];

export const EXERCISE_MEDIA_STATUSES = ["DRAFT", "APPROVED", "RETIRED"] as const;
export type ExerciseMediaStatus = (typeof EXERCISE_MEDIA_STATUSES)[number];

export const EXERCISE_MEDIA_ROLE_ORDER: Record<ExerciseMediaFoundationRole, number> = {
  START_POSITION: 0,
  END_POSITION: 1,
  MUSCLE_MAP: 2,
};

export function isExerciseMediaFoundationRole(value: string): value is ExerciseMediaFoundationRole {
  return (EXERCISE_MEDIA_FOUNDATION_ROLES as readonly string[]).includes(value);
}

export function isExerciseMediaStatus(value: string): value is ExerciseMediaStatus {
  return (EXERCISE_MEDIA_STATUSES as readonly string[]).includes(value);
}

/** Customer-facing media (no storageKey). */
export type ExerciseMediaPublicView = {
  id: string;
  role: ExerciseMediaFoundationRole;
  mediaType: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  altText: string;
  sortOrder: number;
};

/** Admin/OWNER media including storage + provenance metadata. */
export type ExerciseMediaAdminView = ExerciseMediaPublicView & {
  exerciseId: string;
  exerciseRevisionId: string;
  status: ExerciseMediaStatus;
  storageKey: string | null;
  checksum: string | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  promptHash: string | null;
  characterProfileKey: string | null;
  visualStyleKey: string | null;
  outfitProfileKey: string | null;
  backgroundProfileKey: string | null;
  approvedAt: string | null;
  retiredAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type RegisterExerciseMediaInput = {
  role: ExerciseMediaFoundationRole;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  checksum: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  promptHash?: string;
  characterProfileKey?: string;
  visualStyleKey?: string;
  outfitProfileKey?: string;
  backgroundProfileKey?: string;
  altText?: string;
};
