import { describe, expect, it } from "vitest";
import {
  assertCanonicalContent01bValid,
  loadCanonicalContent01b,
  validateCanonicalContent01b,
} from "../catalog/canonical-content-01b.validation";
import {
  CANONICAL_RELEASE_CODE,
  CATALOG_ALGORITHM_VERSION,
  CATALOG_MANIFEST_VERSION,
} from "../catalog/catalog-enums";
import { WORKOUT_CATALOG_MANIFEST } from "../catalog/catalog-manifest";
import {
  generateWeeklyPlanV2,
  VOLUME_CAPS,
  WORKOUT_DAY_SCHEDULE,
} from "../domain/workout-plan-generator";
import type { CatalogExercise, WorkoutPlanGenerateInput } from "../domain/workout-engine.types";

describe("WORKOUT-CATALOG-01B canonical content", () => {
  const sot = loadCanonicalContent01b();

  it("validates cleanly with exact counts", () => {
    expect(validateCanonicalContent01b(sot)).toEqual([]);
    expect(() => assertCanonicalContent01bValid()).not.toThrow();
    expect(sot.exercises.length).toBe(84);
    expect(sot.families.length).toBe(36);
    expect(new Set(sot.exercises.map((e) => e.key)).size).toBe(84);
    expect(sot.releaseCode).toBe(CANONICAL_RELEASE_CODE);
    expect(sot.manifestVersion).toBe(CATALOG_MANIFEST_VERSION);
    expect(sot.algorithmVersion).toBe(CATALOG_ALGORITHM_VERSION);
  });

  it("has 84/84 safety + source + no missing mandatory content", () => {
    expect(sot.exercises.every((e) => e.safety && e.source?.externalReference)).toBe(true);
    expect(validateCanonicalContent01b(sot).filter((i) => i.code === "MISSING_CONTENT")).toEqual(
      [],
    );
  });

  it("treats existing 20 with revision 2 and new 64 with revision 1", () => {
    expect(sot.exercises.filter((e) => e.isExistingApproved).length).toBe(20);
    expect(sot.exercises.filter((e) => !e.isExistingApproved).length).toBe(64);
    for (const ex of sot.exercises) {
      expect(ex.revisionNumber).toBe(ex.isExistingApproved ? 2 : 1);
    }
  });

  it("has no self-candidates or duplicate candidate edges", () => {
    for (const ex of sot.exercises) {
      const keys = ex.candidates.alternatives.map((a) => `${a.key}|${a.relationType}`);
      expect(keys.length).toBe(new Set(keys).size);
      expect(ex.candidates.alternatives.some((a) => a.key === ex.key)).toBe(false);
    }
  });

  it("keeps preferred candidates same-level or easier with priority 0", () => {
    for (const ex of sot.exercises) {
      if (!ex.candidates.alternatives.length) continue;
      const preferred = ex.candidates.alternatives.find((a) => a.priority === 0);
      expect(preferred?.key).toBe(ex.candidates.preferredKey);
      expect(preferred?.relationType).not.toBe("HARDER");
      expect(["EASIER", "SAME_LEVEL"]).toContain(preferred?.relationType);
      const priorities = ex.candidates.alternatives.map((a) => a.priority);
      expect(new Set(priorities).size).toBe(priorities.length);
    }
    expect(sot.exercises.find((e) => e.key === "bodyweight_hip_thrust")?.candidates.preferredKey).toBe(
      "glute_bridge",
    );
    expect(
      sot.exercises.find((e) => e.key === "supported_reverse_lunge")?.candidates.preferredKey,
    ).toBe("bodyweight_squats");
  });

  it("rejects systemic duplicate templates and unsafe wording via validator", () => {
    const issues = validateCanonicalContent01b(sot);
    expect(issues.filter((i) => i.code.startsWith("DUP_"))).toEqual([]);
    expect(issues.filter((i) => i.code === "UNSAFE_PAIN" || i.code === "BAD_GRAMMAR")).toEqual([]);
    expect(issues.filter((i) => i.code === "GENERIC_EXRX_ROOT" || i.code === "BAD_URL")).toEqual([]);
  });

  it("uses semantically varied provenance URLs (not directory root alone)", () => {
    const urls = sot.exercises.map((e) => e.source.externalReference);
    expect(urls.every((u) => /^https?:\/\//.test(u))).toBe(true);
    expect(urls.some((u) => /exrx\.net\/Lists\/Directory\/?$/i.test(u))).toBe(false);
    expect(new Set(urls).size).toBeGreaterThan(20);
  });

  it("aligns inventory keys with TS catalog manifest", () => {
    expect(WORKOUT_CATALOG_MANIFEST.length).toBe(84);
    expect(new Set(WORKOUT_CATALOG_MANIFEST.map((e) => e.familySlug)).size).toBe(36);
  });

  it("covers weekly skeletons 2/3/4 and home+gym equipment scenarios", () => {
    const catalog: CatalogExercise[] = sot.exercises.map((ex) => ({
      id: ex.key,
      key: ex.key,
      name: ex.key,
      nameRu: ex.nameRu,
      riskLevel: ex.riskLevel as CatalogExercise["riskLevel"],
      movementPattern: ex.generatorMovementPattern as CatalogExercise["movementPattern"],
      difficulty: ex.difficulty as CatalogExercise["difficulty"],
      equipmentCodes: ex.equipmentCodes,
      muscleGroups: ex.muscleGroups,
      estimatedMinutes: ex.estimatedMinutes,
      isActive: true,
    }));

    const scenarios: Array<Pick<WorkoutPlanGenerateInput, "trainingPlace" | "equipmentCodes" | "workoutsPerWeek" | "trainingLevel">> = [
      {
        trainingPlace: "HOME",
        equipmentCodes: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"],
        workoutsPerWeek: 2,
        trainingLevel: "BEGINNER",
      },
      {
        trainingPlace: "HOME",
        equipmentCodes: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"],
        workoutsPerWeek: 3,
        trainingLevel: "BEGINNER",
      },
      {
        trainingPlace: "HOME",
        equipmentCodes: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND", "DUMBBELL"],
        workoutsPerWeek: 4,
        trainingLevel: "INTERMEDIATE",
      },
      {
        trainingPlace: "GYM",
        equipmentCodes: [
          "NONE",
          "BODYWEIGHT",
          "DUMBBELL",
          "BARBELL",
          "GYM_MACHINES",
          "CARDIO_MACHINE",
          "BENCH",
          "PULLUP_BAR",
        ],
        workoutsPerWeek: 3,
        trainingLevel: "BEGINNER",
      },
      {
        trainingPlace: "GYM",
        equipmentCodes: [
          "NONE",
          "BODYWEIGHT",
          "DUMBBELL",
          "BARBELL",
          "GYM_MACHINES",
          "CARDIO_MACHINE",
          "BENCH",
        ],
        workoutsPerWeek: 4,
        trainingLevel: "INTERMEDIATE",
      },
    ];

    for (const scenario of scenarios) {
      const plan = generateWeeklyPlanV2(catalog, {
        goalKind: "general_fitness",
        preferredDuration: "STANDARD",
        availableDays: WORKOUT_DAY_SCHEDULE[scenario.workoutsPerWeek],
        excludedKeys: [],
        ...scenario,
      });
      const workoutDays = plan.days.filter((d) => !d.isRestDay);
      expect(workoutDays.length).toBe(scenario.workoutsPerWeek);
      for (const day of workoutDays) {
        expect(day.exercises.length).toBeGreaterThanOrEqual(VOLUME_CAPS.minExercisesPerWorkout);
        for (const row of day.exercises) {
          const key = row.exerciseKey ?? row.exerciseName;
          expect(
            catalog.some((c) => c.key === key),
            `${scenario.trainingPlace}/${scenario.workoutsPerWeek}:${key}`,
          ).toBe(true);
        }
      }
    }
  });

  it("is deterministic across repeated generation", () => {
    const catalog: CatalogExercise[] = sot.exercises.map((ex) => ({
      id: ex.key,
      key: ex.key,
      name: ex.key,
      riskLevel: "low",
      movementPattern: ex.generatorMovementPattern as CatalogExercise["movementPattern"],
      difficulty: ex.difficulty as CatalogExercise["difficulty"],
      equipmentCodes: ex.equipmentCodes,
      isActive: true,
    }));
    const input: WorkoutPlanGenerateInput = {
      goalKind: "lose_weight",
      trainingLevel: "BEGINNER",
      trainingPlace: "HOME",
      workoutsPerWeek: 3,
      preferredDuration: "STANDARD",
      equipmentCodes: ["NONE", "BODYWEIGHT", "RESISTANCE_BAND"],
      availableDays: [0, 2, 4],
      excludedKeys: [],
    };
    const a = generateWeeklyPlanV2(catalog, input);
    const b = generateWeeklyPlanV2(catalog, input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
