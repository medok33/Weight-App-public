import { describe, expect, it } from "vitest";
import { WORKOUT_CATALOG_MANIFEST } from "../catalog/catalog-manifest";
import {
  LEGACY_GENERATOR_EXERCISE_KEYS,
  assertWorkoutCatalogManifestValid,
  manifestFamilyCount,
  manifestStatusCounts,
  validateWorkoutCatalogManifest,
} from "../catalog/catalog-manifest.validation";
import { EXCLUDED_COMPLEX_SLUG_FRAGMENTS } from "../catalog/catalog-enums";
import { assertVariantGraphValid } from "../catalog/variant-graph.validation";

describe("workout catalog manifest", () => {
  it("manifest has exactly 84 entries", () => {
    expect(WORKOUT_CATALOG_MANIFEST.length).toBe(84);
  });

  it("manifest validates cleanly", () => {
    expect(validateWorkoutCatalogManifest()).toEqual([]);
    expect(() => assertWorkoutCatalogManifestValid()).not.toThrow();
  });

  it("manifest family count is exactly 36 (within 35–40 product band)", () => {
    const count = manifestFamilyCount();
    expect(count).toBe(36);
    expect(count >= 35 && count <= 40).toBe(true);
  });

  it("manifest status counts: 20 EXISTING_APPROVED, 64 CANONICAL_01B", () => {
    const counts = manifestStatusCounts();
    expect(counts.EXISTING_APPROVED).toBe(20);
    expect(counts.CANONICAL_01B).toBe(64);
    expect(counts.PLANNED_FOR_01B ?? 0).toBe(0);
    expect(counts.RETIRED_ALIAS ?? 0).toBe(0);
  });

  it("all legacy generator keys are explicitly mapped", () => {
    const mapped = new Set(
      WORKOUT_CATALOG_MANIFEST.filter((e) => e.legacyExerciseKey).map((e) => e.legacyExerciseKey),
    );
    for (const key of LEGACY_GENERATOR_EXERCISE_KEYS) {
      expect(mapped.has(key), key).toBeTruthy();
    }
  });

  it("CANONICAL_01B package provenance remains on the 64 non-legacy rows", () => {
    const legacy = new Set(
      WORKOUT_CATALOG_MANIFEST.filter((e) => e.legacyExerciseKey).map((e) => e.slug),
    );
    for (const entry of WORKOUT_CATALOG_MANIFEST) {
      if (legacy.has(entry.slug)) {
        expect(entry.initialCatalogStatus).toBe("EXISTING_APPROVED");
        expect(entry.plannedContentPackage).toBe("EXISTING");
      } else {
        expect(entry.initialCatalogStatus).toBe("CANONICAL_01B");
        expect(entry.plannedContentPackage).toBe("WORKOUT_CATALOG_01B");
        expect(entry.legacyExerciseKey).toBe(null);
      }
    }
  });

  it("excluded complex movements are absent", () => {
    const slugs = WORKOUT_CATALOG_MANIFEST.map((e) => e.slug);
    for (const frag of EXCLUDED_COMPLEX_SLUG_FRAGMENTS) {
      const hit = slugs.find((s) => {
        const normalized = s.toLowerCase();
        if (frag === "clean") return /(^|_)clean(_|$)/.test(normalized);
        if (frag === "jerk") return /(^|_)jerk(_|$)/.test(normalized);
        return normalized.includes(frag.replace(/-/g, "_")) || normalized.includes(frag);
      });
      expect(hit, `found excluded ${frag} in ${hit}`).toBe(undefined);
    }
  });

  it("barbell advanced basics are not beginnerAllowed", () => {
    for (const slug of [
      "barbell_bench_press",
      "barbell_bent_over_row",
      "barbell_romanian_deadlift",
      "barbell_hip_thrust",
    ]) {
      const entry = WORKOUT_CATALOG_MANIFEST.find((e) => e.slug === slug);
      expect(entry, slug).toBeTruthy();
      expect(entry!.beginnerAllowed).toBe(false);
    }
  });

  it("variant graph validation rejects self edges and bad deltas", () => {
    expect(() =>
      assertVariantGraphValid([
        {
          fromExerciseId: "a",
          toExerciseId: "a",
          relationType: "EASIER",
          levelDelta: -1,
          active: true,
        },
      ]),
    ).toThrow();
    expect(() =>
      assertVariantGraphValid([
        {
          fromExerciseId: "a",
          toExerciseId: "b",
          relationType: "EASIER",
          levelDelta: -1,
          active: true,
        },
        {
          fromExerciseId: "b",
          toExerciseId: "a",
          relationType: "HARDER",
          levelDelta: 1,
          active: true,
        },
      ]),
    ).not.toThrow();
  });

  it("ordinals and slugs are unique", () => {
    const ordinals = new Set(WORKOUT_CATALOG_MANIFEST.map((e) => e.ordinal));
    const slugs = new Set(WORKOUT_CATALOG_MANIFEST.map((e) => e.slug));
    expect(ordinals.size).toBe(84);
    expect(slugs.size).toBe(84);
  });
});
