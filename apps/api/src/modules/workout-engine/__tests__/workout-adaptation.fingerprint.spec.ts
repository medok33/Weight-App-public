import { describe, expect, it } from "vitest";
import {
  computeOptionFingerprint,
  computeSessionStateHash,
  dateOnlyInTimeZone,
  dayIndexInTimeZone,
  normalizeTimeZone,
  stableJson,
} from "../domain/workout-adaptation.fingerprint";
import { WORKOUT_ADAPTATION_POLICY_VERSION } from "../domain/workout-adaptation.types";
import type { AdaptationSessionSnapshot } from "../domain/workout-adaptation.types";

// Day-of-week constants: Monday=0 … Sunday=6
const MON = 0;
const TUE = 1;
const WED = 2;
const THU = 3;
const FRI = 4;
const SAT = 5;
const SUN = 6;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<AdaptationSessionSnapshot> = {}): AdaptationSessionSnapshot {
  return {
    id: "session-1",
    workoutPlanId: "plan-1",
    sourceDayIndex: 0,
    effectiveDayIndex: 0,
    effectiveDate: "2025-01-13",
    dayTitle: "Day 1",
    estimatedMinutes: 30,
    version: 1,
    catalogReleaseId: "release-1",
    exercises: [
      {
        orderIndex: 0,
        exerciseKey: "bodyweight_squats",
        sourceExerciseId: "ex-1",
        exerciseRevisionId: "rev-1",
        catalogReleaseId: "release-1",
        displayNameRu: "Приседания",
        displayNameEn: "Bodyweight squats",
        targetSets: 3,
        targetRepsMin: 10,
        targetRepsMax: 15,
        targetDurationSeconds: null,
        restSeconds: 60,
        techniqueSummaryRu: null,
        techniqueSummaryEn: null,
        commonMistakeRu: null,
        commonMistakeEn: null,
        easierVariantRu: null,
        easierVariantEn: null,
        breathingRu: null,
        breathingEn: null,
        stopConditionsRu: null,
        stopConditionsEn: null,
        media: [],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeTimeZone
// ---------------------------------------------------------------------------

describe("normalizeTimeZone", () => {
  it("returns UTC for null", () => {
    expect(normalizeTimeZone(null)).toBe("UTC");
  });

  it("returns UTC for undefined", () => {
    expect(normalizeTimeZone(undefined)).toBe("UTC");
  });

  it("returns UTC for empty string", () => {
    expect(normalizeTimeZone("")).toBe("UTC");
  });

  it("normalises Etc/UTC → UTC", () => {
    expect(normalizeTimeZone("Etc/UTC")).toBe("UTC");
  });

  it("passthrough for valid zones", () => {
    expect(normalizeTimeZone("Europe/Moscow")).toBe("Europe/Moscow");
    expect(normalizeTimeZone("Europe/Amsterdam")).toBe("Europe/Amsterdam");
    expect(normalizeTimeZone("America/New_York")).toBe("America/New_York");
    expect(normalizeTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("throws WORKOUT_TIMEZONE_INVALID for completely unknown zone", () => {
    expect(() => normalizeTimeZone("Mars/Olympus")).toThrow("WORKOUT_TIMEZONE_INVALID");
  });

  it("throws WORKOUT_TIMEZONE_INVALID for zone without slash", () => {
    // No slash → fails IANA_TIMEZONE_RE
    expect(() => normalizeTimeZone("NotAZone")).toThrow("WORKOUT_TIMEZONE_INVALID");
  });
});

// ---------------------------------------------------------------------------
// dayIndexInTimeZone – MOVE_DAY coverage
// ---------------------------------------------------------------------------

describe("dayIndexInTimeZone", () => {
  // ── UTC anchors ──────────────────────────────────────────────────────────

  it("UTC: 2025-01-13 (Monday) 12:00 → 0", () => {
    const instant = new Date("2025-01-13T12:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(MON);
  });

  it("UTC: 2025-01-14 (Tuesday) 12:00 → 1", () => {
    const instant = new Date("2025-01-14T12:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(TUE);
  });

  it("UTC: 2025-01-12 (Sunday) 12:00 → 6", () => {
    const instant = new Date("2025-01-12T12:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
  });

  // ── Europe/Moscow (UTC+3, no DST) ───────────────────────────────────────

  it("Europe/Moscow: 2025-01-13 12:00 UTC (15:00 MSK) → still Monday (0)", () => {
    const instant = new Date("2025-01-13T12:00:00.000Z");
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(MON);
  });

  it("Europe/Moscow: 2025-01-15 23:30 UTC → Thursday 02:30 MSK → Thursday (3)", () => {
    // UTC Wednesday 23:30 → MSK Thursday 02:30 → dayIndex=THU
    const instant = new Date("2025-01-15T23:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(WED);
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(THU);
  });

  it("Europe/Moscow: 2025-01-17 21:00 UTC → 00:00 MSK Saturday Jan 18 → Saturday (5)", () => {
    // 21:00 UTC + 3h = 00:00 midnight Moscow → crosses into Saturday
    const instant = new Date("2025-01-17T21:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(FRI);
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(SAT);
  });

  it("Europe/Moscow: 2025-01-19 23:00 UTC → Sunday 02:00 MSK → Sunday (6)", () => {
    const instant = new Date("2025-01-19T23:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(MON); // 02:00 MSK Monday
  });

  // ── Europe/Amsterdam – standard winter (CET = UTC+1) ────────────────────

  it("Europe/Amsterdam winter: 2025-01-13 11:00 UTC = 12:00 CET → Monday (0)", () => {
    const instant = new Date("2025-01-13T11:00:00.000Z");
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(MON);
  });

  it("Europe/Amsterdam winter: 2025-01-12 23:30 UTC = 00:30 CET next day → Monday (0)", () => {
    // Sunday 23:30 UTC + 1h = Monday 00:30 CET
    const instant = new Date("2025-01-12T23:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(MON);
  });

  // ── Europe/Amsterdam – DST spring (late March 2025) ─────────────────────
  // DST change: 2025-03-30 01:00 UTC clocks spring forward to 03:00 CEST (UTC+2)

  it("DST pre-spring: 2025-03-29 23:30 UTC (Saturday) = 00:30 CET → Sunday Amsterdam (6)", () => {
    // 23:30 UTC + 1h CET = 00:30 next day = Sunday March 30 in Amsterdam
    const instant = new Date("2025-03-29T23:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SAT);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("DST spring-forward moment: 2025-03-30 01:30 UTC = 03:30 CEST → Sunday Amsterdam (6)", () => {
    const instant = new Date("2025-03-30T01:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  // ── Europe/Amsterdam – DST autumn (late October 2025) ───────────────────
  // DST change: 2025-10-26 01:00 UTC clocks fall back to 02:00 CET (UTC+1)

  it("DST pre-autumn: 2025-10-26 00:30 UTC = 02:30 CEST → Sunday Amsterdam (6)", () => {
    // CEST (UTC+2) still active before 01:00 UTC
    const instant = new Date("2025-10-26T00:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("DST post-autumn: 2025-10-26 01:30 UTC = 02:30 CET → Sunday Amsterdam (6)", () => {
    // CET (UTC+1) active after 01:00 UTC fall-back
    const instant = new Date("2025-10-26T01:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("DST autumn boundary: Saturday midnight UTC = just before fall-back → Amsterdam still Saturday (5)", () => {
    // 2025-10-25 22:30 UTC + 2h CEST = 00:30 Sunday Amsterdam (Oct 26)
    const instant = new Date("2025-10-25T22:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SAT);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  // ── Full week cycle verification (UTC) ──────────────────────────────────

  it.each([
    ["2025-01-13", MON],
    ["2025-01-14", TUE],
    ["2025-01-15", WED],
    ["2025-01-16", THU],
    ["2025-01-17", FRI],
    ["2025-01-18", SAT],
    ["2025-01-19", SUN],
  ])("UTC noon %s → dayIndex %i", (dateStr, expected) => {
    const instant = new Date(`${dateStr}T12:00:00.000Z`);
    expect(dayIndexInTimeZone("UTC", instant)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// dateOnlyInTimeZone
// ---------------------------------------------------------------------------

describe("dateOnlyInTimeZone", () => {
  const WED_2330_UTC = new Date("2025-01-15T23:30:00.000Z");

  it("UTC: 2025-01-15 23:30 → '2025-01-15'", () => {
    expect(dateOnlyInTimeZone("UTC", WED_2330_UTC)).toBe("2025-01-15");
  });

  it("Europe/Moscow (UTC+3): 2025-01-15 23:30 UTC → '2025-01-16'", () => {
    expect(dateOnlyInTimeZone("Europe/Moscow", WED_2330_UTC)).toBe("2025-01-16");
  });

  it("America/New_York (UTC-5 in Jan): 2025-01-15 23:30 UTC → '2025-01-15'", () => {
    // 23:30 - 5h = 18:30 EST still Jan 15
    expect(dateOnlyInTimeZone("America/New_York", WED_2330_UTC)).toBe("2025-01-15");
  });

  it("Europe/Amsterdam (CET, UTC+1 in Jan): 2025-01-15 23:30 UTC → '2025-01-16'", () => {
    // 23:30 + 1h = 00:30 Jan 16 Amsterdam
    expect(dateOnlyInTimeZone("Europe/Amsterdam", WED_2330_UTC)).toBe("2025-01-16");
  });

  it("returns YYYY-MM-DD format", () => {
    const result = dateOnlyInTimeZone("UTC", new Date("2025-01-01T00:00:00.000Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("DST boundary: 2025-03-29 23:30 UTC → '2025-03-30' in Amsterdam (CET +1h)", () => {
    const instant = new Date("2025-03-29T23:30:00.000Z");
    expect(dateOnlyInTimeZone("UTC", instant)).toBe("2025-03-29");
    expect(dateOnlyInTimeZone("Europe/Amsterdam", instant)).toBe("2025-03-30");
  });
});

// ---------------------------------------------------------------------------
// stableJson
// ---------------------------------------------------------------------------

describe("stableJson", () => {
  it("sorts object keys canonically", () => {
    expect(stableJson({ b: 2, a: 1 })).toBe(JSON.stringify({ a: 1, b: 2 }));
  });

  it("is idempotent regardless of insertion order", () => {
    const v1 = { z: "z", a: "a", m: "m" };
    const v2 = { m: "m", z: "z", a: "a" };
    expect(stableJson(v1)).toBe(stableJson(v2));
  });

  it("recursively sorts nested objects", () => {
    const result = stableJson({ b: { y: 1, x: 2 }, a: 0 });
    expect(result).toBe(JSON.stringify({ a: 0, b: { x: 2, y: 1 } }));
  });

  it("does not sort arrays (order is preserved)", () => {
    const arr = [3, 1, 2];
    expect(stableJson(arr)).toBe(JSON.stringify(arr));
  });
});

// ---------------------------------------------------------------------------
// computeSessionStateHash
// ---------------------------------------------------------------------------

describe("computeSessionStateHash", () => {
  it("is deterministic for identical input", () => {
    const s = makeSnapshot();
    expect(computeSessionStateHash(s)).toBe(computeSessionStateHash(s));
  });

  it("returns a 64-char hex string (SHA-256)", () => {
    expect(computeSessionStateHash(makeSnapshot())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when effectiveDayIndex changes", () => {
    const a = makeSnapshot({ effectiveDayIndex: 0 });
    const b = makeSnapshot({ effectiveDayIndex: 2 });
    expect(computeSessionStateHash(a)).not.toBe(computeSessionStateHash(b));
  });

  it("differs when effectiveDate changes", () => {
    const a = makeSnapshot({ effectiveDate: "2025-01-13" });
    const b = makeSnapshot({ effectiveDate: "2025-01-15" });
    expect(computeSessionStateHash(a)).not.toBe(computeSessionStateHash(b));
  });

  it("differs when exerciseKey changes", () => {
    const ex = makeSnapshot().exercises[0]!;
    const a = makeSnapshot({ exercises: [{ ...ex, exerciseKey: "squat" }] });
    const b = makeSnapshot({ exercises: [{ ...ex, exerciseKey: "lunge" }] });
    expect(computeSessionStateHash(a)).not.toBe(computeSessionStateHash(b));
  });

  it("differs when catalogReleaseId changes", () => {
    const a = makeSnapshot({ catalogReleaseId: "release-a" });
    const b = makeSnapshot({ catalogReleaseId: "release-b" });
    expect(computeSessionStateHash(a)).not.toBe(computeSessionStateHash(b));
  });

  it("is stable across key-insertion-order variation (uses stableJson internally)", () => {
    // Build two snapshots via spread in different order.
    const base = makeSnapshot();
    // Shuffling the exercises array order should NOT affect hash (same exercises, same order).
    const same = { ...base };
    expect(computeSessionStateHash(base)).toBe(computeSessionStateHash(same));
  });

  it("includes displayNameRu in the hash (content-sensitive)", () => {
    const ex = makeSnapshot().exercises[0]!;
    const a = makeSnapshot({ exercises: [{ ...ex, displayNameRu: "Приседания" }] });
    const b = makeSnapshot({ exercises: [{ ...ex, displayNameRu: "Выпады" }] });
    expect(computeSessionStateHash(a)).not.toBe(computeSessionStateHash(b));
  });
});

// ---------------------------------------------------------------------------
// computeOptionFingerprint – determinism & sensitivity
// ---------------------------------------------------------------------------

describe("computeOptionFingerprint", () => {
  const snapshot = makeSnapshot();

  const baseInput = {
    intent: "HOME" as const,
    optionCode: "home-bodyweight-01",
    policyVersion: WORKOUT_ADAPTATION_POLICY_VERSION,
    catalogReleaseId: "release-1",
    sessionVersion: 1,
    option: {
      optionCode: "home-bodyweight-01",
      recommended: true,
      titleRu: "Провести дома",
      summaryRu: "Заменяем упражнения на домашние",
      optionFingerprint: "", // filled by computeOptionFingerprint
      estimatedMinutesBefore: { min: 27, max: 33 },
      estimatedMinutesAfter: { min: 25, max: 31 },
      goalImpact: {
        policyVersion: WORKOUT_ADAPTATION_POLICY_VERSION,
        impactCategory: "MOSTLY_PRESERVED" as const,
        trainingStimulus: "slightly_lower" as const,
        durationChange: "unchanged" as const,
        recoveryEffect: "unchanged" as const,
        weeklyConsistency: "preserved" as const,
        summaryRu: "Тренировка дома немного снизит нагрузку.",
        detailsRu: [],
        disclaimerRu: "Оценка приблизительная и не является медицинским или физиологическим прогнозом.",
      },
      preview: snapshot,
    },
  };

  it("returns a deterministic hex string", () => {
    const fp1 = computeOptionFingerprint(baseInput);
    const fp2 = computeOptionFingerprint(baseInput);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when intent changes", () => {
    const fp1 = computeOptionFingerprint(baseInput);
    const fp2 = computeOptionFingerprint({ ...baseInput, intent: "LIGHTER" as const });
    expect(fp1).not.toBe(fp2);
  });

  it("differs when optionCode changes", () => {
    const fp1 = computeOptionFingerprint(baseInput);
    const fp2 = computeOptionFingerprint({ ...baseInput, optionCode: "different-code" });
    expect(fp1).not.toBe(fp2);
  });

  it("differs when sessionVersion changes", () => {
    const fp1 = computeOptionFingerprint(baseInput);
    const fp2 = computeOptionFingerprint({ ...baseInput, sessionVersion: 2 });
    expect(fp1).not.toBe(fp2);
  });

  it("differs when catalogReleaseId changes", () => {
    const fp1 = computeOptionFingerprint(baseInput);
    const fp2 = computeOptionFingerprint({ ...baseInput, catalogReleaseId: "release-2" });
    expect(fp1).not.toBe(fp2);
  });
});
