import { describe, expect, it } from 'vitest';
import { TIMING_CONTENT_MAPPINGS } from '../timing-content-manifest';
import {
  assertTimingCandidatesAreNonRuntime,
  TIMING_COUNTING_SEMANTICS_BLOCKED_KEYS,
  TIMING_EVIDENCE_BLOCKED_COUNTING_SEMANTICS,
  TIMING_REVIEW_CANDIDATES,
  TIMING_REVIEW_CANDIDATE_ARTIFACT_VERSION,
} from '../timing-review-candidates';
import { listPublishedReleasePinsFromSoT } from '../release-pin-resolver';
import { analyseContentCoverage } from '../coverage-analyser';
import { sumTimingPhases } from '../timing-methodology';

describe('timing review candidates (non-runtime)', () => {
  it('covers all 58 REPS pins; APPROVED mirror production; blocked counting is fail-closed', () => {
    const reps = listPublishedReleasePinsFromSoT().filter((p) => p.repetitionMode === 'REPS');
    expect(reps).toHaveLength(58);
    expect(TIMING_REVIEW_CANDIDATES).toHaveLength(58);
    expect(TIMING_REVIEW_CANDIDATE_ARTIFACT_VERSION).toContain('01b-batch-02-fix-01');
    assertTimingCandidatesAreNonRuntime();

    const approved = TIMING_REVIEW_CANDIDATES.filter((r) => r.disposition === 'TIMING_APPROVED');
    const blocked = TIMING_REVIEW_CANDIDATES.filter(
      (r) => r.disposition === 'TIMING_EVIDENCE_BLOCKED',
    );
    expect(approved).toHaveLength(TIMING_CONTENT_MAPPINGS.length);
    expect(blocked).toHaveLength(TIMING_COUNTING_SEMANTICS_BLOCKED_KEYS.length);

    for (const row of TIMING_REVIEW_CANDIDATES) {
      expect(row.runtimeEligible).toBe(false);
      expect(row.artifactOnly).toBe(true);
    }
    for (const row of approved) {
      expect(row.blocker).toBeNull();
      expect(row.candidateSecondsPerRep).not.toBeNull();
      expect(TIMING_CONTENT_MAPPINGS.some((e) => e.exerciseKey === row.exerciseKey)).toBe(true);
    }
    for (const key of TIMING_COUNTING_SEMANTICS_BLOCKED_KEYS) {
      const row = TIMING_REVIEW_CANDIDATES.find((r) => r.exerciseKey === key)!;
      expect(row.disposition).toBe('TIMING_EVIDENCE_BLOCKED');
      expect(row.blocker).toBe(TIMING_EVIDENCE_BLOCKED_COUNTING_SEMANTICS);
      expect(row.candidateSecondsPerRep).toBeNull();
      expect(TIMING_CONTENT_MAPPINGS.some((e) => e.exerciseKey === key)).toBe(false);
    }
  });

  it('does not count candidates as a second production SoT; coverage uses TIMING_CONTENT_MAPPINGS only', () => {
    expect(TIMING_CONTENT_MAPPINGS).toHaveLength(49);
    const report = analyseContentCoverage();
    expect(report.repositoryTimingMappings).toBe(49);
    expect(report.availableReps).toBe(49);
    expect(report.missingTiming).toBe(9);
  });
});

describe('static unilateral timing semantics (F-TIM-01)', () => {
  it('static split squats omit per-rep sideTransition; secondsPerRep = phase sum', () => {
    for (const key of ['static_split_squat', 'dumbbell_goblet_split_squat'] as const) {
      const row = TIMING_CONTENT_MAPPINGS.find((e) => e.exerciseKey === key)!;
      expect(row).toBeDefined();
      expect(row.movementPhases.sideTransitionSeconds).toBeUndefined();
      expect(row.unilateralSemantics.toLowerCase()).toContain('static');
      expect(row.secondsPerRep).toBeCloseTo(sumTimingPhases(row.movementPhases), 9);
    }
  });

  it('does not forbid sideTransitionSeconds for true alternating movements in the phase model type', () => {
    // Alternating REPS currently fail-closed (not in production). If a future proven
    // alternating entry includes sideTransitionSeconds, that remains a valid phase key.
    const phases = {
      eccentricSeconds: 1,
      concentricSeconds: 1,
      sideTransitionSeconds: 0.4,
    };
    expect(sumTimingPhases(phases)).toBeCloseTo(2.4, 9);
  });
});

describe('counting semantics fail-closed (F-TIM-02)', () => {
  it('removes unproven alternating counting keys from production timing', () => {
    for (const key of TIMING_COUNTING_SEMANTICS_BLOCKED_KEYS) {
      expect(TIMING_CONTENT_MAPPINGS.some((e) => e.exerciseKey === key)).toBe(false);
    }
  });
});

describe('chest-supported row decisive bilateral (F-TIM-03)', () => {
  it('uses decisive bilateral semantics without hedge', () => {
    const row = TIMING_CONTENT_MAPPINGS.find(
      (e) => e.exerciseKey === 'chest_supported_dumbbell_row',
    )!;
    expect(row.unilateralSemantics).toBe('bilateral');
    expect(row.unilateralSemantics.toLowerCase()).not.toMatch(/bilateral or unilateral/);
    expect(row.oneRepDefinition.toLowerCase()).toContain('bilateral');
  });
});
