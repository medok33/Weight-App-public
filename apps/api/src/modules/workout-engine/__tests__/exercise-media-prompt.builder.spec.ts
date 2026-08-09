import { describe, expect, it } from "vitest";
import {
  createExerciseMediaGeneratorFromEnv,
  DisabledExerciseMediaGenerator,
} from "../catalog/disabled-exercise-media.generator";
import { buildExerciseMediaPrompt } from "../catalog/exercise-media-prompt.builder";
import {
  EXERCISE_MEDIA_VISUAL_PROFILE_KEYS,
  EXERCISE_MEDIA_VISUAL_PROFILES,
} from "../catalog/exercise-media-visual-profiles";
import type { ExerciseMediaGeneratorRequest } from "../catalog/exercise-media.generator";
import { EXERCISE_MEDIA_FOUNDATION_ROLES } from "../domain/exercise-media.types";

const baseInput = {
  exerciseName: "Glute Bridge",
  movementDescription: "Hip extension from floor",
  startPositionDescription: "Supine, knees bent, feet flat",
  endPositionDescription: "Hips raised, glutes contracted",
  primaryMuscles: ["gluteus maximus"],
  secondaryMuscles: ["hamstrings"],
  cameraDirection: "straight-on full body",
  bodyView: "full body visible",
};

function sampleRequest(
  overrides: Partial<ExerciseMediaGeneratorRequest> = {},
): ExerciseMediaGeneratorRequest {
  return {
    exerciseRevisionId: "00000000-0000-4000-8000-000000000001",
    exerciseName: baseInput.exerciseName,
    role: "START_POSITION",
    movementDescription: baseInput.movementDescription,
    startPositionDescription: baseInput.startPositionDescription,
    endPositionDescription: baseInput.endPositionDescription,
    primaryMuscles: baseInput.primaryMuscles,
    secondaryMuscles: baseInput.secondaryMuscles,
    cameraDirection: baseInput.cameraDirection,
    bodyView: baseInput.bodyView,
    characterProfileKey: EXERCISE_MEDIA_VISUAL_PROFILES.characterProfileKey,
    visualStyleKey: EXERCISE_MEDIA_VISUAL_PROFILES.visualStyleKey,
    outfitProfileKey: EXERCISE_MEDIA_VISUAL_PROFILES.outfitProfileKey,
    backgroundProfileKey: EXERCISE_MEDIA_VISUAL_PROFILES.backgroundProfileKey,
    promptVersion: EXERCISE_MEDIA_VISUAL_PROFILES.promptVersion,
    ...overrides,
  };
}

describe("exercise media visual profile registry", () => {
  it("contains the exact five canonical keys", () => {
    expect(EXERCISE_MEDIA_VISUAL_PROFILES).toEqual({
      characterProfileKey: "weight-female-v1",
      visualStyleKey: "calm-premium-v1",
      outfitProfileKey: "forest-graphite-v1",
      backgroundProfileKey: "warm-studio-v1",
      promptVersion: "exercise-media-v1",
    });
    expect([...EXERCISE_MEDIA_VISUAL_PROFILE_KEYS]).toEqual([
      "weight-female-v1",
      "calm-premium-v1",
      "forest-graphite-v1",
      "warm-studio-v1",
      "exercise-media-v1",
    ]);
  });
});

describe("exercise media prompt builder", () => {
  it("supports all three foundation roles", () => {
    for (const role of EXERCISE_MEDIA_FOUNDATION_ROLES) {
      const built = buildExerciseMediaPrompt({ ...baseInput, role });
      expect(built.role).toBe(role);
      expect(built.prompt).toContain(`Role: ${role}`);
      expect(built.prompt).toContain("NEGATIVE:");
      expect(built.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(built.promptVersion).toBe("exercise-media-v1");
    }
  });

  it("same input yields same prompt and promptHash", () => {
    const a = buildExerciseMediaPrompt({ ...baseInput, role: "END_POSITION" });
    const b = buildExerciseMediaPrompt({ ...baseInput, role: "END_POSITION" });
    expect(a.prompt).toBe(b.prompt);
    expect(a.promptHash).toBe(b.promptHash);
  });

  it("changing promptVersion changes promptHash", () => {
    const base = buildExerciseMediaPrompt({ ...baseInput, role: "MUSCLE_MAP" });
    const changed = buildExerciseMediaPrompt({
      ...baseInput,
      role: "MUSCLE_MAP",
      profiles: { promptVersion: "exercise-media-v1-changed" },
    });
    expect(changed.promptHash).not.toBe(base.promptHash);
    expect(changed.promptVersion).toBe("exercise-media-v1-changed");
  });

  it("changing a profile key changes promptHash", () => {
    const base = buildExerciseMediaPrompt({ ...baseInput, role: "START_POSITION" });
    const changed = buildExerciseMediaPrompt({
      ...baseInput,
      role: "START_POSITION",
      profiles: { characterProfileKey: "weight-female-v2" },
    });
    expect(changed.promptHash).not.toBe(base.promptHash);
    expect(changed.characterProfileKey).toBe("weight-female-v2");
  });
});

describe("DisabledExerciseMediaGenerator", () => {
  it("returns controlled unavailable without network calls", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network must not be called");
    }) as typeof fetch;

    try {
      const generator = new DisabledExerciseMediaGenerator("disabled");
      const result = await generator.generate(sampleRequest());
      expect(result).toEqual({
        status: "unavailable",
        reason: "disabled",
        message: "Exercise media generation is disabled",
      });
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("missing image config does not break factory/startup path", () => {
    const gen = createExerciseMediaGeneratorFromEnv({
      EXERCISE_MEDIA_GENERATION_ENABLED: "false",
      OPENAI_API_KEY: "",
      OPENAI_IMAGE_MODEL: "",
    });
    expect(gen).toBeInstanceOf(DisabledExerciseMediaGenerator);
  });

  it("enabled without key stays not_configured (no OpenAI client)", async () => {
    const gen = createExerciseMediaGeneratorFromEnv({
      EXERCISE_MEDIA_GENERATION_ENABLED: "true",
      OPENAI_API_KEY: "",
    });
    const result = await gen.generate(sampleRequest());
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("not_configured");
  });
});
