/**
 * NON-RUNTIME timing review matrix for all REPS pins.
 * Disposition reflects production progress; loader MUST NOT import this file.
 * Coverage MUST NOT count these as production.
 * Production SoT: TIMING_CONTENT_MAPPINGS (timing-content-batch-02).
 */
import { listPublishedReleasePinsFromSoT } from './release-pin-resolver';
import { TIMING_CONTENT_MAPPINGS } from './timing-content-manifest';

export const TIMING_REVIEW_CANDIDATE_ARTIFACT_VERSION =
  'workout-energy-timing-review-candidates-01b-batch-02-fix-01' as const;

/** FAIL-CLOSED: product does not prove left vs left+right = one rep. */
export const TIMING_COUNTING_SEMANTICS_BLOCKED_KEYS = [
  'bird_dog',
  'dead_bug',
  'heel_taps',
  'glute_bridge_march',
  'dumbbell_step_up',
  'low_step_up',
  'reverse_lunge',
  'supported_reverse_lunge',
  'band_lateral_walk',
] as const;

export const TIMING_EVIDENCE_BLOCKED_COUNTING_SEMANTICS =
  'TIMING_EVIDENCE_BLOCKED_COUNTING_SEMANTICS' as const;

export type TimingReviewDisposition =
  | 'TIMING_APPROVED'
  | 'TIMING_REVIEW_CANDIDATE'
  | 'TIMING_EVIDENCE_BLOCKED'
  | 'NO_TIMING_REQUIRED';

export type TimingReviewCandidateRow = {
  exerciseKey: string;
  expectedPublishedRevisionNumber: number;
  repetitionMode: 'REPS' | 'DURATION' | 'REPS_OR_DURATION';
  movementDescription: string;
  techniqueSource: string;
  romAssumptions: string;
  eccentricPhase: string;
  transitionOrBottomPause: string;
  concentricPhase: string;
  topPause: string;
  unilateralOrBilateral: string;
  oneRepDefinition: string;
  cadenceAssumptions: string;
  candidateSecondsPerRep: number | null;
  uncertainty: string;
  blocker: string | null;
  disposition: TimingReviewDisposition;
  artifactOnly: true;
  runtimeEligible: false;
};

function repsCandidate(
  exerciseKey: string,
  revisionNumber: number,
  notes: {
    movementDescription: string;
    unilateralOrBilateral: string;
    oneRepDefinition: string;
  },
): TimingReviewCandidateRow {
  const production = TIMING_CONTENT_MAPPINGS.find((row) => row.exerciseKey === exerciseKey);
  if (production) {
    return {
      exerciseKey,
      expectedPublishedRevisionNumber: revisionNumber,
      repetitionMode: 'REPS',
      movementDescription: notes.movementDescription,
      techniqueSource: 'canonical-content-01b.json technique/instructions (catalog SoT)',
      romAssumptions: production.romAssumptions,
      eccentricPhase: `production phaseModel: ${production.phaseModel}`,
      transitionOrBottomPause: 'See production movementPhases (timing-content-batch-02).',
      concentricPhase: 'See production movementPhases (timing-content-batch-02).',
      topPause: 'See production movementPhases (timing-content-batch-02).',
      unilateralOrBilateral: notes.unilateralOrBilateral,
      oneRepDefinition: production.oneRepDefinition,
      cadenceAssumptions: production.cadenceAssumptions,
      candidateSecondsPerRep: production.secondsPerRep,
      uncertainty:
        'Production INTERNAL_REVIEWED_TEMPO_POLICY estimate; not laboratory measurement.',
      blocker: null,
      disposition: 'TIMING_APPROVED',
      artifactOnly: true,
      runtimeEligible: false,
    };
  }

  const countingBlocked = (TIMING_COUNTING_SEMANTICS_BLOCKED_KEYS as readonly string[]).includes(
    exerciseKey,
  );
  const blocker = countingBlocked
    ? TIMING_EVIDENCE_BLOCKED_COUNTING_SEMANTICS
    : 'TIMING_EVIDENCE_BLOCKED';
  return {
    exerciseKey,
    expectedPublishedRevisionNumber: revisionNumber,
    repetitionMode: 'REPS',
    movementDescription: notes.movementDescription,
    techniqueSource: 'canonical-content-01b.json technique/instructions (catalog SoT)',
    romAssumptions:
      'ROM follows catalog technique text; no lab-measured joint angles available.',
    eccentricPhase: 'UNDEFINED — TIMING_EVIDENCE_BLOCKED.',
    transitionOrBottomPause: 'UNDEFINED — TIMING_EVIDENCE_BLOCKED.',
    concentricPhase: 'UNDEFINED — TIMING_EVIDENCE_BLOCKED.',
    topPause: 'UNDEFINED — TIMING_EVIDENCE_BLOCKED.',
    unilateralOrBilateral: notes.unilateralOrBilateral,
    oneRepDefinition: notes.oneRepDefinition,
    cadenceAssumptions:
      'FORBIDDEN: universal cadence, default 2.5s, family/name fallback, estimatedDurationSeconds, Compendium-as-cadence.',
    candidateSecondsPerRep: null,
    uncertainty: countingBlocked
      ? 'Catalog technique describes movement but does not prove whether one side = one rep or left+right = one rep; generator/session store a bare targetReps integer with no counting annotation. Fail closed — no invented prescription semantics.'
      : 'No approved production timing entry for this exact revision.',
    blocker,
    disposition: 'TIMING_EVIDENCE_BLOCKED',
    artifactOnly: true,
    runtimeEligible: false,
  };
}

const MOVEMENT_NOTES: Record<
  string,
  { movementDescription: string; unilateralOrBilateral: string; oneRepDefinition: string }
> = {
  assisted_pull_up_machine: {
    movementDescription: 'Assisted pull-up',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pull to chin/chest path + descent',
  },
  back_extension_machine: {
    movementDescription: 'Back extension machine',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One extension + return',
  },
  band_chest_press: {
    movementDescription: 'Band chest press',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  band_face_pull: {
    movementDescription: 'Band face pull',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pull to face + return',
  },
  band_glute_bridge: {
    movementDescription: 'Band glute bridge',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One hip extension + return',
  },
  band_lat_pulldown: {
    movementDescription: 'Band lat pulldown',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pulldown + return',
  },
  band_lateral_walk: {
    movementDescription: 'Band lateral walk',
    unilateralOrBilateral: 'alternating lateral steps — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog does not define whether one lateral step = one rep or a left+right pair = one rep',
  },
  band_overhead_press: {
    movementDescription: 'Band overhead press',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  band_pull_apart: {
    movementDescription: 'Band pull-apart',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One open + return',
  },
  band_row: {
    movementDescription: 'Band horizontal row',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pull to torso + return to stretch start',
  },
  band_squat: {
    movementDescription: 'Band squat',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One squat cycle to stand',
  },
  barbell_bench_press: {
    movementDescription: 'Barbell bench press',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  barbell_bent_over_row: {
    movementDescription: 'Barbell bent-over row',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pull + return',
  },
  barbell_hip_thrust: {
    movementDescription: 'Barbell hip thrust',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One hip extension + return',
  },
  barbell_romanian_deadlift: {
    movementDescription: 'Barbell Romanian deadlift',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One hinge + stand',
  },
  bird_dog: {
    movementDescription: 'Bird dog',
    unilateralOrBilateral: 'alternating contralateral limbs — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog describes contralateral reach but not whether one side = one rep or left+right = one rep',
  },
  bodyweight_hip_thrust: {
    movementDescription: 'Bodyweight hip thrust',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One hip extension + return',
  },
  bodyweight_squats: {
    movementDescription: 'Bodyweight squat',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One squat cycle to stand',
  },
  box_squat_to_chair: {
    movementDescription: 'Box squat to chair',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One sit-to-stand cycle',
  },
  cable_chest_press: {
    movementDescription: 'Cable chest press',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  cable_row: {
    movementDescription: 'Cable row',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pull + return',
  },
  chair_sit_to_stand: {
    movementDescription: 'Chair sit-to-stand',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One sit-to-stand cycle',
  },
  chest_press_machine: {
    movementDescription: 'Chest press machine',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  chest_supported_dumbbell_row: {
    movementDescription: 'Chest-supported dumbbell row',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One bilateral dumbbell pull to sides + controlled return',
  },
  dead_bug: {
    movementDescription: 'Dead bug',
    unilateralOrBilateral: 'alternating contralateral limbs — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog describes contralateral lower but not whether one side = one rep or left+right = one rep',
  },
  dumbbell_floor_press: {
    movementDescription: 'Dumbbell floor press',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  dumbbell_goblet_split_squat: {
    movementDescription: 'Dumbbell goblet split squat',
    unilateralOrBilateral: 'static unilateral stance (no per-rep side switch)',
    oneRepDefinition: 'One descent + ascent while remaining in the same split stance',
  },
  dumbbell_lateral_raise: {
    movementDescription: 'Dumbbell lateral raise',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One raise to target height + return',
  },
  dumbbell_romanian_deadlift: {
    movementDescription: 'Dumbbell Romanian deadlift',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One hinge + stand',
  },
  dumbbell_row: {
    movementDescription: 'Dumbbell row',
    unilateralOrBilateral: 'unilateral (single working arm; brace on other side)',
    oneRepDefinition:
      'One complete pull-and-return cycle performed by the working arm (side switch is outside the timed repetition)',
  },
  dumbbell_shoulder_press: {
    movementDescription: 'Dumbbell shoulder press',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  dumbbell_step_up: {
    movementDescription: 'Dumbbell step-up',
    unilateralOrBilateral: 'unilateral step — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog describes one step-up cycle but not whether sides alternate per rep or per set, nor left vs left+right counting',
  },
  glute_bridge: {
    movementDescription: 'Glute bridge',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One hip extension + return',
  },
  glute_bridge_march: {
    movementDescription: 'Glute bridge march',
    unilateralOrBilateral: 'alternating march — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog describes alternating foot lifts but not whether one lift = one rep or left+right = one rep',
  },
  goblet_squat: {
    movementDescription: 'Goblet squat',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One squat cycle to stand',
  },
  good_morning_bodyweight: {
    movementDescription: 'Bodyweight good morning',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One hinge + stand',
  },
  heel_taps: {
    movementDescription: 'Heel taps',
    unilateralOrBilateral: 'alternating taps — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog describes alternating heel taps but not whether one tap = one rep or left+right = one rep',
  },
  incline_push_ups: {
    movementDescription: 'Incline push-up',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One lower + press',
  },
  knee_push_ups: {
    movementDescription: 'Knee push-up',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One lower + press',
  },
  lat_pulldown: {
    movementDescription: 'Lat pulldown',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pulldown + return',
  },
  lat_pulldown_neutral_grip: {
    movementDescription: 'Lat pulldown neutral grip',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pulldown + return',
  },
  leg_extension_machine: {
    movementDescription: 'Leg extension machine',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One extension + return',
  },
  low_step_up: {
    movementDescription: 'Low step-up',
    unilateralOrBilateral: 'unilateral step — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog describes one step-up cycle but not whether sides alternate per rep or per set, nor left vs left+right counting',
  },
  machine_hip_abduction: {
    movementDescription: 'Machine hip abduction',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One abduction + return',
  },
  machine_leg_press: {
    movementDescription: 'Machine leg press',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  pallof_press_band: {
    movementDescription: 'Pallof press (band)',
    unilateralOrBilateral: 'anti-rotation; side-specific',
    oneRepDefinition: 'One anti-rotation press-out to arms-extended + controlled return to chest',
  },
  pec_deck_machine: {
    movementDescription: 'Pec deck machine',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One squeeze + return',
  },
  push_ups: {
    movementDescription: 'Push-up',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One lower + press',
  },
  reverse_lunge: {
    movementDescription: 'Reverse lunge',
    unilateralOrBilateral: 'unilateral lunge — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog describes one reverse-lunge cycle but not whether one side = one rep or left+right = one rep',
  },
  seated_cable_row: {
    movementDescription: 'Seated cable row',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pull + return',
  },
  seated_calf_raise_machine: {
    movementDescription: 'Seated calf raise machine',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One raise + return',
  },
  seated_leg_curl_machine: {
    movementDescription: 'Seated leg curl machine',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One curl + return',
  },
  seated_machine_shoulder_press: {
    movementDescription: 'Seated machine shoulder press',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One press + return',
  },
  side_lying_clamshell: {
    movementDescription: 'Side-lying clamshell',
    unilateralOrBilateral: 'unilateral',
    oneRepDefinition: 'One open + close of top knee',
  },
  standing_band_row: {
    movementDescription: 'Standing band row',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One pull + return',
  },
  standing_calf_raise: {
    movementDescription: 'Standing calf raise',
    unilateralOrBilateral: 'bilateral',
    oneRepDefinition: 'One plantarflexion + return',
  },
  static_split_squat: {
    movementDescription: 'Static split squat',
    unilateralOrBilateral: 'static unilateral stance (no per-rep side switch)',
    oneRepDefinition: 'One descent + ascent while remaining in the same split stance',
  },
  supported_reverse_lunge: {
    movementDescription: 'Supported reverse lunge',
    unilateralOrBilateral: 'unilateral lunge — counting unproven',
    oneRepDefinition:
      'UNPROVEN: catalog describes one reverse-lunge cycle but not whether one side = one rep or left+right = one rep',
  },
};

function buildTimingReviewCandidates(): readonly TimingReviewCandidateRow[] {
  const pins = listPublishedReleasePinsFromSoT().filter((p) => p.repetitionMode === 'REPS');
  return pins.map((pin) => {
    const notes = MOVEMENT_NOTES[pin.exerciseKey] ?? {
      movementDescription: `REPS exercise ${pin.exerciseKey} per catalog technique`,
      unilateralOrBilateral: 'per catalog technique',
      oneRepDefinition: 'One complete repetition as defined by catalog technique text',
    };
    return repsCandidate(pin.exerciseKey, pin.revisionNumber, notes);
  });
}

/** All 58 REPS pins — review artifact only. */
export const TIMING_REVIEW_CANDIDATES: readonly TimingReviewCandidateRow[] =
  buildTimingReviewCandidates();

export function assertTimingCandidatesAreNonRuntime(): void {
  if (TIMING_REVIEW_CANDIDATES.some((row) => row.runtimeEligible !== false)) {
    throw new Error('TIMING_CANDIDATES_MUST_BE_NON_RUNTIME');
  }
  if (TIMING_REVIEW_CANDIDATES.some((row) => row.artifactOnly !== true)) {
    throw new Error('TIMING_CANDIDATES_MUST_BE_ARTIFACT_ONLY');
  }
  for (const row of TIMING_REVIEW_CANDIDATES) {
    if (row.disposition === 'TIMING_APPROVED') {
      const production = TIMING_CONTENT_MAPPINGS.find((e) => e.exerciseKey === row.exerciseKey);
      if (!production) {
        throw new Error(`TIMING_CANDIDATE_APPROVED_WITHOUT_PRODUCTION:${row.exerciseKey}`);
      }
      if (row.candidateSecondsPerRep !== production.secondsPerRep) {
        throw new Error(`TIMING_CANDIDATE_SPR_MISMATCH:${row.exerciseKey}`);
      }
      if (row.blocker != null) {
        throw new Error(`TIMING_CANDIDATE_APPROVED_STILL_BLOCKED:${row.exerciseKey}`);
      }
    } else if (row.disposition === 'TIMING_EVIDENCE_BLOCKED') {
      if (row.candidateSecondsPerRep != null) {
        throw new Error(`TIMING_CANDIDATE_BLOCKED_HAS_SECONDS:${row.exerciseKey}`);
      }
      if (TIMING_CONTENT_MAPPINGS.some((e) => e.exerciseKey === row.exerciseKey)) {
        throw new Error(`TIMING_CANDIDATE_BLOCKED_BUT_PRODUCTION_EXISTS:${row.exerciseKey}`);
      }
      const countingBlocked = (TIMING_COUNTING_SEMANTICS_BLOCKED_KEYS as readonly string[]).includes(
        row.exerciseKey,
      );
      if (countingBlocked && row.blocker !== TIMING_EVIDENCE_BLOCKED_COUNTING_SEMANTICS) {
        throw new Error(`TIMING_CANDIDATE_COUNTING_BLOCKER_MISMATCH:${row.exerciseKey}`);
      }
    }
  }
}
