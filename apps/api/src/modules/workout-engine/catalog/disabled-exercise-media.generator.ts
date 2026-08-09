import type {
  ExerciseMediaGenerator,
  ExerciseMediaGeneratorRequest,
  ExerciseMediaGeneratorResult,
} from "./exercise-media.generator";

/**
 * Controlled no-op adapter. Never calls external APIs.
 * Missing image config / disabled flag must not break API or worker startup.
 */
export class DisabledExerciseMediaGenerator implements ExerciseMediaGenerator {
  constructor(
    private readonly reason: "not_configured" | "disabled" = "disabled",
  ) {}

  async generate(request: ExerciseMediaGeneratorRequest): Promise<ExerciseMediaGeneratorResult> {
    void request;
    return {
      status: "unavailable",
      reason: this.reason,
      message:
        this.reason === "not_configured"
          ? "Exercise media generation is not configured"
          : "Exercise media generation is disabled",
    };
  }
}

export function createExerciseMediaGeneratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ExerciseMediaGenerator {
  const enabled = String(env.EXERCISE_MEDIA_GENERATION_ENABLED ?? "false").toLowerCase() === "true";
  if (!enabled) return new DisabledExerciseMediaGenerator("disabled");
  if (!String(env.OPENAI_API_KEY ?? "").trim()) {
    return new DisabledExerciseMediaGenerator("not_configured");
  }
  // OpenAI HTTP client is intentionally not implemented in 01C-A/FIX1.
  return new DisabledExerciseMediaGenerator("not_configured");
}
