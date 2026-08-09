import type { ExerciseMediaFoundationRole } from "../domain/exercise-media.types";

export type ExerciseMediaGeneratorRequest = {
  exerciseRevisionId: string;
  exerciseName: string;
  role: ExerciseMediaFoundationRole;
  movementDescription: string;
  startPositionDescription: string;
  endPositionDescription: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  cameraDirection?: string;
  bodyView?: string;
  characterProfileKey: string;
  visualStyleKey: string;
  outfitProfileKey: string;
  backgroundProfileKey: string;
  promptVersion: string;
};

export type ExerciseMediaGeneratorResult =
  | {
      status: "unavailable";
      reason: "not_configured" | "disabled";
      message: string;
    };

/**
 * Internal contract for future OpenAI Image generation.
 * 01C-A / FIX1 ships only a disabled/not-configured adapter — no HTTP client.
 */
export interface ExerciseMediaGenerator {
  generate(request: ExerciseMediaGeneratorRequest): Promise<ExerciseMediaGeneratorResult>;
}
