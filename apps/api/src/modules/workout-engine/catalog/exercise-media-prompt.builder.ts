import { createHash } from "node:crypto";
import {
  EXERCISE_MEDIA_VISUAL_PROFILES,
  type ExerciseMediaVisualProfiles,
} from "./exercise-media-visual-profiles";
import type { ExerciseMediaFoundationRole } from "../domain/exercise-media.types";
import { isExerciseMediaFoundationRole } from "../domain/exercise-media.types";

export type ExerciseMediaPromptInput = {
  role: ExerciseMediaFoundationRole;
  exerciseName: string;
  movementDescription: string;
  startPositionDescription: string;
  endPositionDescription: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  cameraDirection?: string;
  bodyView?: string;
  profiles?: Partial<ExerciseMediaVisualProfiles>;
};

export type ExerciseMediaBuiltPrompt = {
  role: ExerciseMediaFoundationRole;
  promptVersion: string;
  characterProfileKey: string;
  visualStyleKey: string;
  outfitProfileKey: string;
  backgroundProfileKey: string;
  prompt: string;
  promptHash: string;
};

const SHARED_CHARACTER_BLOCK = [
  "Fictional brand character for a weight-loss fitness app.",
  "One consistent adult woman: attractive brunette with warm features,",
  "athletic, slender, feminine, realistic proportions — not a bodybuilder.",
  "Dark hair in a neat ponytail. Independent fictional person;",
  "not based on any celebrity or specific real individual.",
].join(" ");

const OUTFIT_BLOCK = [
  "Outfit locked: deep forest-green top, graphite leggings, light footwear.",
  "Modest athletic clothing only.",
].join(" ");

const BACKGROUND_STYLE_BLOCK = [
  "Warm light studio background, calm premium aesthetic,",
  "iOS-like minimalism, soft even lighting, uncluttered.",
].join(" ");

const NEGATIVE_CONSTRAINTS = [
  "no celebrity likeness",
  "no specific real person resemblance",
  "no bodybuilder proportions",
  "no sexualized pose",
  "no revealing clothing",
  "no incorrect anatomy",
  "no extra limbs or fingers",
  "no cropped hands, feet, or joints",
  "no changed character, outfit, camera, background, light, or scale between START and END",
  "no logos, text, or watermark",
  "no collage",
  "no additional people",
  "no busy gym or neon background",
  "no visual noise",
].join("; ");

function resolveProfiles(
  override?: Partial<ExerciseMediaVisualProfiles>,
): ExerciseMediaVisualProfiles {
  return {
    characterProfileKey:
      override?.characterProfileKey ?? EXERCISE_MEDIA_VISUAL_PROFILES.characterProfileKey,
    visualStyleKey: override?.visualStyleKey ?? EXERCISE_MEDIA_VISUAL_PROFILES.visualStyleKey,
    outfitProfileKey: override?.outfitProfileKey ?? EXERCISE_MEDIA_VISUAL_PROFILES.outfitProfileKey,
    backgroundProfileKey:
      override?.backgroundProfileKey ?? EXERCISE_MEDIA_VISUAL_PROFILES.backgroundProfileKey,
    promptVersion: override?.promptVersion ?? EXERCISE_MEDIA_VISUAL_PROFILES.promptVersion,
  };
}

function muscleList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none specified";
}

function roleTemplate(input: ExerciseMediaPromptInput): string {
  const camera = input.cameraDirection?.trim() || "straight-on full body";
  const bodyView = input.bodyView?.trim() || "full body visible";
  const start = input.startPositionDescription.trim();
  const end = input.endPositionDescription.trim();
  const movement = input.movementDescription.trim();
  const name = input.exerciseName.trim();

  if (input.role === "START_POSITION") {
    return [
      `Role: START_POSITION for exercise "${name}".`,
      `Movement context: ${movement}.`,
      `Show the start posture exactly: ${start}.`,
      `Camera: ${camera}. Body view: ${bodyView}.`,
      "Same character, outfit, camera, background, light, and scale as END_POSITION.",
    ].join(" ");
  }

  if (input.role === "END_POSITION") {
    return [
      `Role: END_POSITION for exercise "${name}".`,
      `Movement context: ${movement}.`,
      `Show the end / key phase exactly: ${end}.`,
      `Camera: ${camera}. Body view: ${bodyView}.`,
      "Same character, outfit, camera, background, light, and scale as START_POSITION.",
    ].join(" ");
  }

  return [
    `Role: MUSCLE_MAP for exercise "${name}".`,
    `Movement context: ${movement}.`,
    "Full-body anatomical emphasis on a calm figure matching the brand character.",
    `Primary working muscles (soft coral highlight): ${muscleList(input.primaryMuscles)}.`,
    `Secondary muscles (muted peach highlight): ${muscleList(input.secondaryMuscles)}.`,
    "No neon, no logos, no sexualization.",
  ].join(" ");
}

/** Canonical prompt text used for generation readiness and hashing. */
export function buildExerciseMediaPromptText(
  input: ExerciseMediaPromptInput,
  profiles: ExerciseMediaVisualProfiles = resolveProfiles(input.profiles),
): string {
  if (!isExerciseMediaFoundationRole(input.role)) {
    throw new Error("EXERCISE_MEDIA_ROLE_INVALID");
  }
  return [
    `promptVersion=${profiles.promptVersion}`,
    `characterProfileKey=${profiles.characterProfileKey}`,
    `visualStyleKey=${profiles.visualStyleKey}`,
    `outfitProfileKey=${profiles.outfitProfileKey}`,
    `backgroundProfileKey=${profiles.backgroundProfileKey}`,
    "CHARACTER:",
    SHARED_CHARACTER_BLOCK,
    "OUTFIT:",
    OUTFIT_BLOCK,
    "SCENE:",
    BACKGROUND_STYLE_BLOCK,
    "ROLE:",
    roleTemplate(input),
    "NEGATIVE:",
    NEGATIVE_CONSTRAINTS,
  ].join("\n");
}

/**
 * Deterministic SHA-256 over canonical prompt + promptVersion + visual profile keys.
 * Same input → same hash; changing promptVersion or any profile key → different hash.
 */
export function computeExerciseMediaPromptHash(
  prompt: string,
  profiles: ExerciseMediaVisualProfiles,
): string {
  const canonical = [
    profiles.promptVersion,
    profiles.characterProfileKey,
    profiles.visualStyleKey,
    profiles.outfitProfileKey,
    profiles.backgroundProfileKey,
    prompt,
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function buildExerciseMediaPrompt(input: ExerciseMediaPromptInput): ExerciseMediaBuiltPrompt {
  const profiles = resolveProfiles(input.profiles);
  const prompt = buildExerciseMediaPromptText(input, profiles);
  return {
    role: input.role,
    promptVersion: profiles.promptVersion,
    characterProfileKey: profiles.characterProfileKey,
    visualStyleKey: profiles.visualStyleKey,
    outfitProfileKey: profiles.outfitProfileKey,
    backgroundProfileKey: profiles.backgroundProfileKey,
    prompt,
    promptHash: computeExerciseMediaPromptHash(prompt, profiles),
  };
}
