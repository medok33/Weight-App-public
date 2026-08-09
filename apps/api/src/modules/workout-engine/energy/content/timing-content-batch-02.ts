/**
 * WORKOUT-ENERGY-CONTENT-01B timing batch-02 — production APPROVED REPS timing.
 * Methodology: workout-energy-timing-reviewed-v1 (INTERNAL_REVIEWED_TEMPO_POLICY).
 * FIX-01: static split per-rep sideTransition removed; ambiguous alternating counting
 * fail-closed (removed from production); chest-supported row decisive bilateral;
 * exercise-specific rationales strengthened.
 * FIX-02: band_row / dumbbell_row decisive semantics; per-entry contentVersion bump for changed payloads only.
 * secondsPerRep is always the sum of explicit movementPhases (no independent magic number).
 */
import { WORKOUT_ENERGY_TIMING_POLICY_VERSION } from '../workout-energy.types';
import { withTimingChecksum } from './content-checksum';
import {
  WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
  type TimingContentEntry,
  type TimingMovementPhases,
} from './content.types';
import {
  WORKOUT_ENERGY_TIMING_CONTENT_VERSION,
  WORKOUT_ENERGY_TIMING_CONTENT_VERSION_FIX_02,
  WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION,
  WORKOUT_ENERGY_TIMING_REVIEWED_AT,
  WORKOUT_ENERGY_TIMING_REVIEWED_BY,
  WORKOUT_ENERGY_TIMING_SOURCE_VERSION,
  assertSecondsPerRepMatchesPhases,
  serializeTimingPhaseModel,
} from './timing-methodology';

const SOURCE_REFERENCE_BASE =
  'INTERNAL_REVIEWED_TEMPO_POLICY workout-energy-timing-reviewed-v1 — Weight App internal product tempo methodology for catalog REPS estimation. Not laboratory measurement; not Compendium cadence; not ACSM prescription; not medical advice.';

type TimingDraft = Omit<TimingContentEntry, 'checksum'>;

function draft(partial: {
  exerciseKey: string;
  expectedPublishedRevisionNumber: number;
  secondsPerRep: number;
  movementPhases: TimingMovementPhases;
  oneRepDefinition: string;
  unilateralSemantics: string;
  romAssumptions: string;
  techniqueAssumptions: string;
  cadenceAssumptions: string;
  rationale: string;
  limitations: string;
  /** Override only when checksum-covered semantic payload changes (FIX-02+). */
  contentVersion?: string;
}): TimingDraft {
  assertSecondsPerRepMatchesPhases(partial.secondsPerRep, partial.movementPhases);
  const phaseModel = serializeTimingPhaseModel(partial.movementPhases);
  const contentVersion = partial.contentVersion ?? WORKOUT_ENERGY_TIMING_CONTENT_VERSION;
  const sourceReference =
    SOURCE_REFERENCE_BASE +
    '\n' +
    `WA_CONTENT_VERSION_V1=${contentVersion}`;
  return {
    exerciseKey: partial.exerciseKey,
    expectedPublishedRevisionNumber: partial.expectedPublishedRevisionNumber,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_TIMING_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion,
    timingMethod: 'SECONDS_PER_REP',
    secondsPerRep: partial.secondsPerRep,
    evidenceClass: 'INTERNAL_REVIEWED_TEMPO_POLICY',
    sourceType: 'INTERNAL_REVIEWED_POLICY',
    sourceReference,
    sourceVersion: WORKOUT_ENERGY_TIMING_SOURCE_VERSION,
    methodologyVersion: WORKOUT_ENERGY_TIMING_METHODOLOGY_VERSION,
    oneRepDefinition: partial.oneRepDefinition,
    unilateralSemantics: partial.unilateralSemantics,
    movementPhases: partial.movementPhases,
    phaseModel,
    rationale: partial.rationale,
    romAssumptions: partial.romAssumptions,
    techniqueAssumptions: partial.techniqueAssumptions,
    cadenceAssumptions: partial.cadenceAssumptions,
    limitations: partial.limitations,
    reviewedBy: WORKOUT_ENERGY_TIMING_REVIEWED_BY,
    reviewedAt: WORKOUT_ENERGY_TIMING_REVIEWED_AT,
    status: 'APPROVED',
  };
}

const TIMING_BATCH_02_DRAFTS: readonly TimingDraft[] = [
  draft({
    exerciseKey: 'assisted_pull_up_machine',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3.05,
    movementPhases: {
      eccentricSeconds: 1.25,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.35,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One pull to chin/chest path + descent',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for assisted_pull_up_machine; no lab-measured joint angles.',
    techniqueAssumptions:
      'Machine assistance set; shoulders depressed; pull elbows down per catalog techniqueRu for exact published revision.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2500;bottomTransitionSeconds=0.2000;concentricSeconds=1.3500;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for assisted_pull_up_machine under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Assisted pull-up machine: elbows drive down while chest rises toward handles under assistance, brief top path, controlled lower to start hang; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'back_extension_machine',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3.2,
    movementPhases: {
      eccentricSeconds: 1.5,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One extension + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for back_extension_machine; no lab-measured joint angles.',
    techniqueAssumptions:
      'Pad/hip support adjusted; extend to neutral (not hyperextension) per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5000;bottomTransitionSeconds=0.2000;concentricSeconds=1.2000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for back_extension_machine under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Back-extension machine: pelvis on pad, torso rises to neutral line, brief hold, controlled flexion return; bilateral trunk pattern, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'band_chest_press',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.7,
    movementPhases: {
      eccentricSeconds: 1.4,
      bottomTransitionSeconds: 0.1,
      concentricSeconds: 1,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One press + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for band_chest_press; no lab-measured joint angles.',
    techniqueAssumptions:
      'Band fixed behind torso at chest level; stable trunk; press forward per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4000;bottomTransitionSeconds=0.1000;concentricSeconds=1.0000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for band_chest_press under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Band chest press: band anchored behind at chest height, arms press forward to extension, brief, controlled return against band tension; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'band_face_pull',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.7,
    movementPhases: {
      eccentricSeconds: 1.1,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.1,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One pull to face + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for band_face_pull; no lab-measured joint angles.',
    techniqueAssumptions:
      'Pull band toward face with elbows flared at comfortable height per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.1000;bottomTransitionSeconds=0.2000;concentricSeconds=1.1000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for band_face_pull under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Band face pull: pull to face with hands parting and elbows out, brief end-range, controlled return; bilateral rear-delt pattern, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'band_glute_bridge',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.7,
    movementPhases: {
      eccentricSeconds: 1.15,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1,
      topTransitionSeconds: 0.35,
    },
    oneRepDefinition: 'One bridge + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for band_glute_bridge; no lab-measured joint angles.',
    techniqueAssumptions:
      'Band above knees; bridge without lumbar arch per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.1500;bottomTransitionSeconds=0.2000;concentricSeconds=1.0000;topTransitionSeconds=0.3500; secondsPerRep is the arithmetic sum of explicit phases for band_glute_bridge under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Banded glute bridge: hips extend to bridge with band above knees resisting valgus, brief top squeeze, controlled lower; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'band_lat_pulldown',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.8,
    movementPhases: {
      eccentricSeconds: 1.15,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.25,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One pulldown + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for band_lat_pulldown; no lab-measured joint angles.',
    techniqueAssumptions:
      'Band anchored overhead; pull to upper chest per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.1500;bottomTransitionSeconds=0.2000;concentricSeconds=1.2500;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for band_lat_pulldown under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Band lat pulldown: overhead band pulls to upper chest with elbows to sides, brief, controlled ascent of hands; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'band_overhead_press',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.65,
    movementPhases: {
      eccentricSeconds: 1.15,
      bottomTransitionSeconds: 0.1,
      concentricSeconds: 1.15,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One press + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for band_overhead_press; no lab-measured joint angles.',
    techniqueAssumptions:
      'Feet secure on band; ribs stacked over pelvis; overhead press path per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.1500;bottomTransitionSeconds=0.1000;concentricSeconds=1.1500;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for band_overhead_press under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Band overhead press: stand on band, press arms overhead to lockout path, brief, controlled lower; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'band_pull_apart',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.6,
    movementPhases: {
      eccentricSeconds: 1.2,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One horizontal abduction + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for band_pull_apart; no lab-measured joint angles.',
    techniqueAssumptions:
      'Band at chest height; retract scapulae without shrugging per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2000;bottomTransitionSeconds=0.2000;concentricSeconds=1.0000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for band_pull_apart under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Band pull-apart: hands start in front of chest, band stretches as scapulae retract, brief, controlled return; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'band_row',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.55,
    movementPhases: {
      eccentricSeconds: 1,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.15,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One pull to torso + return to stretch start',
    unilateralSemantics: 'bilateral',
    contentVersion: WORKOUT_ENERGY_TIMING_CONTENT_VERSION_FIX_02,
    romAssumptions:
      'ROM follows canonical catalog technique for band_row; no lab-measured joint angles.',
    techniqueAssumptions:
      'Band anchored securely; elbows to ribs without shoulder elevation per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.0000;bottomTransitionSeconds=0.2000;concentricSeconds=1.1500;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for band_row under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Band row: elbows pull back toward ribs with scapular retraction, brief squeeze, controlled arm extension; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'band_squat',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.9,
    movementPhases: {
      eccentricSeconds: 1.45,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One squat cycle',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for band_squat; no lab-measured joint angles.',
    techniqueAssumptions:
      'Band above knees; squat depth and knee tracking per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4500;bottomTransitionSeconds=0.2000;concentricSeconds=1.0000;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for band_squat under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Band squat: band above knees, hips sit back/down with knees tracking toes, stand to full extension; bilateral stance, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'barbell_bench_press',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3,
    movementPhases: {
      eccentricSeconds: 1.6,
      bottomTransitionSeconds: 0.15,
      concentricSeconds: 1,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One press + controlled descent',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for barbell_bench_press; no lab-measured joint angles.',
    techniqueAssumptions:
      'Stable bench setup; controlled bar to mid-chest per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.6000;bottomTransitionSeconds=0.1500;concentricSeconds=1.0000;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for barbell_bench_press under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Barbell bench press: bar lowers under control to mid-chest contact, brief bottom, press to elbow extension; bilateral bar path, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'barbell_bent_over_row',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.75,
    movementPhases: {
      eccentricSeconds: 1.05,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.25,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One pull + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for barbell_bent_over_row; no lab-measured joint angles.',
    techniqueAssumptions:
      'Hip hinge with neutral spine; bar near legs; pull to lower ribs per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.0500;bottomTransitionSeconds=0.2000;concentricSeconds=1.2500;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for barbell_bent_over_row under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Barbell bent-over row: hinged torso fixed, bar pulls to lower ribs, brief, controlled lower toward floor; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'barbell_hip_thrust',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.9,
    movementPhases: {
      eccentricSeconds: 1.25,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.05,
      topTransitionSeconds: 0.4,
    },
    oneRepDefinition: 'One hip extension + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for barbell_hip_thrust; no lab-measured joint angles.',
    techniqueAssumptions:
      'Upper back on bench; bar padded on hips; controlled hip extension per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2500;bottomTransitionSeconds=0.2000;concentricSeconds=1.0500;topTransitionSeconds=0.4000; secondsPerRep is the arithmetic sum of explicit phases for barbell_hip_thrust under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Barbell hip thrust: upper back on bench, padded bar over hips, hips extend to lockout, brief, controlled lower; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'barbell_romanian_deadlift',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 3.85,
    movementPhases: {
      eccentricSeconds: 2.1,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.25,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One hinge descent + return to stand',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for barbell_romanian_deadlift; no lab-measured joint angles.',
    techniqueAssumptions:
      'Bar close to legs; neutral spine hinge per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=2.1000;bottomTransitionSeconds=0.2000;concentricSeconds=1.2500;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for barbell_romanian_deadlift under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Barbell RDL: bar stays close to legs while hips hinge back with soft knees, brief bottom stretch, stand to hip extension; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'bodyweight_hip_thrust',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.7,
    movementPhases: {
      eccentricSeconds: 1.2,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One hip extension + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for bodyweight_hip_thrust; no lab-measured joint angles.',
    techniqueAssumptions:
      'Upper back on stable bench; hip extension without lumbar flare per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2000;bottomTransitionSeconds=0.2000;concentricSeconds=1.0000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for bodyweight_hip_thrust under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Bodyweight hip thrust: upper back on bench, hips drive up with chin slightly tucked, brief, controlled lower; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'bodyweight_squats',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 3,
    movementPhases: {
      eccentricSeconds: 1.5,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One full descent + ascent returning to start stance',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for bodyweight_squats; no lab-measured joint angles.',
    techniqueAssumptions:
      'Feet flat; knees track toes; depth per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5000;bottomTransitionSeconds=0.2000;concentricSeconds=1.0000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for bodyweight_squats under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Bodyweight squat: hips sit back and down with feet planted and knees tracking toes, stand to full extension; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'box_squat_to_chair',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3.2,
    movementPhases: {
      eccentricSeconds: 1.6,
      bottomTransitionSeconds: 0.3,
      concentricSeconds: 1,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One touch-to-box + stand',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for box_squat_to_chair; no lab-measured joint angles.',
    techniqueAssumptions:
      'Light chair contact only (no sit-collapse) per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.6000;bottomTransitionSeconds=0.3000;concentricSeconds=1.0000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for box_squat_to_chair under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Box/chair squat: hips reach back to light chair touch without collapsing onto seat, then stand; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'cable_chest_press',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.85,
    movementPhases: {
      eccentricSeconds: 1.5,
      bottomTransitionSeconds: 0.1,
      concentricSeconds: 1.05,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One press + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for cable_chest_press; no lab-measured joint angles.',
    techniqueAssumptions:
      'Stable stance between cables; press forward without trunk rotation per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5000;bottomTransitionSeconds=0.1000;concentricSeconds=1.0500;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for cable_chest_press under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Cable chest press: stable stance between stacks, handles press forward without torso twist, brief, controlled return; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'cable_row',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.65,
    movementPhases: {
      eccentricSeconds: 1.05,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One pull + return to stretch',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for cable_row; no lab-measured joint angles.',
    techniqueAssumptions:
      'Seated tall; pull to abdomen with depressed shoulders per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.0500;bottomTransitionSeconds=0.2000;concentricSeconds=1.2000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for cable_row under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Cable row: seated upright, handle pulls to abdomen with shoulders down, brief, controlled arm extension; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'chair_sit_to_stand',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3.05,
    movementPhases: {
      eccentricSeconds: 1.4,
      bottomTransitionSeconds: 0.25,
      concentricSeconds: 1.1,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One stand from sit + controlled return to sit',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for chair_sit_to_stand; no lab-measured joint angles.',
    techniqueAssumptions:
      'Stable chair edge; stand via leg drive per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4000;bottomTransitionSeconds=0.2500;concentricSeconds=1.1000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for chair_sit_to_stand under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Chair sit-to-stand: sit on chair edge, feet under knees, stand by driving legs, controlled re-sit; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'chest_press_machine',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.8,
    movementPhases: {
      eccentricSeconds: 1.45,
      bottomTransitionSeconds: 0.1,
      concentricSeconds: 1,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One press + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for chest_press_machine; no lab-measured joint angles.',
    techniqueAssumptions:
      'Seat height matches mid-chest handles; back stays on pad per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4500;bottomTransitionSeconds=0.1000;concentricSeconds=1.0000;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for chest_press_machine under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Chest-press machine: seat set so handles meet mid-chest, press without back leaving pad, brief, controlled return; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'chest_supported_dumbbell_row',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.6,
    movementPhases: {
      eccentricSeconds: 1,
      bottomTransitionSeconds: 0.15,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One bilateral dumbbell pull to sides + controlled return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for chest_supported_dumbbell_row; no lab-measured joint angles.',
    techniqueAssumptions:
      'Chest on incline bench; pull both dumbbells to sides without lifting chest (techniqueRu: «тяните гантели»).',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.0000;bottomTransitionSeconds=0.1500;concentricSeconds=1.2000;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for chest_supported_dumbbell_row under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Chest-supported dumbbell row: chest stays on incline pad while both dumbbells row to the sides, brief squeeze, controlled lower; techniqueRu uses plural dumbbells — decisive bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'dumbbell_floor_press',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.8,
    movementPhases: {
      eccentricSeconds: 1.4,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One press + return to floor touch',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for dumbbell_floor_press; no lab-measured joint angles.',
    techniqueAssumptions:
      'Supine on floor; elbows lightly touch floor at bottom per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4000;bottomTransitionSeconds=0.2000;concentricSeconds=1.0000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for dumbbell_floor_press under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Dumbbell floor press: dumbbells start over chest, elbows lower to light floor touch, press to extension; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'dumbbell_goblet_split_squat',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3,
    movementPhases: {
      eccentricSeconds: 1.55,
      bottomTransitionSeconds: 0.25,
      concentricSeconds: 1.2,
    },
    oneRepDefinition: 'One descent + ascent while remaining in the same split stance',
    unilateralSemantics: 'static unilateral stance (side change is not a per-rep phase)',
    romAssumptions:
      'ROM follows canonical catalog technique for dumbbell_goblet_split_squat; no lab-measured joint angles.',
    techniqueAssumptions:
      'Dumbbell at chest; static split stance; lower pelvis then rise on front leg (techniqueRu); side switch between sets is out of per-rep scope.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5500;bottomTransitionSeconds=0.2500;concentricSeconds=1.2000; secondsPerRep is the arithmetic sum of explicit phases for dumbbell_goblet_split_squat under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Goblet split squat: hold dumbbell at chest in a fixed split stance, lower pelvis straight down, drive up on the front leg; catalog technique keeps the same разножка within the rep — no per-rep sideTransitionSeconds.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'dumbbell_lateral_raise',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3,
    movementPhases: {
      eccentricSeconds: 1.4,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One raise to target height + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for dumbbell_lateral_raise; no lab-measured joint angles.',
    techniqueAssumptions:
      'Slight elbow bend; raise to comfortable height; no torso swing per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4000;bottomTransitionSeconds=0.2000;concentricSeconds=1.2000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for dumbbell_lateral_raise under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Dumbbell lateral raise: slightly bent elbows raise dumbbells out to comfortable height with shoulders down, brief, controlled lower. Independent phase analysis (raise 1.2 / top 0.2 / lower 1.4 / bottom 0.2) matches the same numerical tuple as seated machine knee curl/extension because each is a short isolation raise/lower with brief end-range — coincidence of tempo, not a shared template default.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'dumbbell_romanian_deadlift',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3.7,
    movementPhases: {
      eccentricSeconds: 2,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One hinge + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for dumbbell_romanian_deadlift; no lab-measured joint angles.',
    techniqueAssumptions:
      'Dumbbells along legs; hip hinge to comfortable depth per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=2.0000;bottomTransitionSeconds=0.2000;concentricSeconds=1.2000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for dumbbell_romanian_deadlift under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Dumbbell RDL: dumbbells travel along thighs as hips hinge back, brief bottom, stand to hip extension; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'dumbbell_row',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.65,
    movementPhases: {
      eccentricSeconds: 1,
      bottomTransitionSeconds: 0.25,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition:
      'One complete pull-and-return cycle performed by the working arm (side switch is outside the timed repetition)',
    unilateralSemantics: 'unilateral (single working arm; brace on other side)',
    contentVersion: WORKOUT_ENERGY_TIMING_CONTENT_VERSION_FIX_02,
    romAssumptions:
      'ROM follows canonical catalog technique for dumbbell_row; no lab-measured joint angles.',
    techniqueAssumptions:
      'Support hand braced; pull elbow to hip without rotating torso per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.0000;bottomTransitionSeconds=0.2500;concentricSeconds=1.2000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for dumbbell_row under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Single-arm dumbbell row: free hand braced, elbow pulls dumbbell to hip without torso twist, brief, controlled lower; unilateral working arm with contralateral brace — one arm cycle = one rep; no alternating sideTransition inside the counted rep.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'dumbbell_shoulder_press',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.9,
    movementPhases: {
      eccentricSeconds: 1.25,
      bottomTransitionSeconds: 0.15,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One press overhead + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for dumbbell_shoulder_press; no lab-measured joint angles.',
    techniqueAssumptions:
      'Stable seated/standing base; overhead path without lumbar arch per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2500;bottomTransitionSeconds=0.1500;concentricSeconds=1.2000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for dumbbell_shoulder_press under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Dumbbell shoulder press: seated or standing stable base, dumbbells press on a comfortable overhead path without lumbar arch, brief, controlled lower; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'glute_bridge',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.6,
    movementPhases: {
      eccentricSeconds: 1.15,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 0.95,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One hip raise + controlled return to floor',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for glute_bridge; no lab-measured joint angles.',
    techniqueAssumptions:
      'Supine; feet close to hips; bridge without lumbar flare per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.1500;bottomTransitionSeconds=0.2000;concentricSeconds=0.9500;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for glute_bridge under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Glute bridge: feet near hips, lift pelvis by glute squeeze without lumbar arch, brief, controlled lower; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'goblet_squat',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 3.1,
    movementPhases: {
      eccentricSeconds: 1.55,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.05,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One descent + ascent with load at chest',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for goblet_squat; no lab-measured joint angles.',
    techniqueAssumptions:
      'Dumbbell at chest; squat between feet with upright torso per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5500;bottomTransitionSeconds=0.2000;concentricSeconds=1.0500;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for goblet_squat under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Goblet squat: dumbbell held at chest, hips sit between feet, stand with upright torso; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'good_morning_bodyweight',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3.6,
    movementPhases: {
      eccentricSeconds: 1.9,
      bottomTransitionSeconds: 0.25,
      concentricSeconds: 1.15,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One hinge + return to upright',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for good_morning_bodyweight; no lab-measured joint angles.',
    techniqueAssumptions:
      'Hands on chest; hip hinge with long spine per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.9000;bottomTransitionSeconds=0.2500;concentricSeconds=1.1500;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for good_morning_bodyweight under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Bodyweight good morning: hands on chest, hips hinge back with long spine, brief, return to stand; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'incline_push_ups',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.65,
    movementPhases: {
      eccentricSeconds: 1.4,
      bottomTransitionSeconds: 0.1,
      concentricSeconds: 0.95,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One lower + press',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for incline_push_ups; no lab-measured joint angles.',
    techniqueAssumptions:
      'Hands on stable high surface; rigid trunk; chest to edge per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4000;bottomTransitionSeconds=0.1000;concentricSeconds=0.9500;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for incline_push_ups under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Incline push-up: hands on elevated stable surface, chest lowers to edge, press to lockout with rigid trunk; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'knee_push_ups',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.5,
    movementPhases: {
      eccentricSeconds: 1.3,
      bottomTransitionSeconds: 0.1,
      concentricSeconds: 0.9,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One lower + press',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for knee_push_ups; no lab-measured joint angles.',
    techniqueAssumptions:
      'Hands and knees; head-to-knee alignment; controlled lower per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.3000;bottomTransitionSeconds=0.1000;concentricSeconds=0.9000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for knee_push_ups under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Knee push-up: hands and knees support, head-to-knee line stays straight while chest lowers and presses; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'lat_pulldown',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.9,
    movementPhases: {
      eccentricSeconds: 1.2,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.3,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One pull to upper chest/chin path + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for lat_pulldown; no lab-measured joint angles.',
    techniqueAssumptions:
      'Thighs fixed; pull bar to upper chest with elbows down per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2000;bottomTransitionSeconds=0.2000;concentricSeconds=1.3000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for lat_pulldown under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Lat pulldown: thighs secured, bar pulls to upper chest with elbows down, brief, controlled ascent; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'lat_pulldown_neutral_grip',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.9,
    movementPhases: {
      eccentricSeconds: 1.15,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.3,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One pulldown + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for lat_pulldown_neutral_grip; no lab-measured joint angles.',
    techniqueAssumptions:
      'Neutral handles; pull to upper chest without throwing torso back per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.1500;bottomTransitionSeconds=0.2000;concentricSeconds=1.3000;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for lat_pulldown_neutral_grip under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Neutral-grip lat pulldown: parallel handles pull to upper chest without leaning back excessively, brief, controlled return; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'leg_extension_machine',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3,
    movementPhases: {
      eccentricSeconds: 1.4,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One extension + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for leg_extension_machine; no lab-measured joint angles.',
    techniqueAssumptions:
      'Pad above ankles; smooth knee extension without hard lockout slam per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4000;bottomTransitionSeconds=0.2000;concentricSeconds=1.2000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for leg_extension_machine under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Leg-extension machine: pad above ankles, knees extend smoothly without slamming at top, brief, controlled flexion return. Independent phase analysis yields raise 1.2 / top 0.2 / lower 1.4 / bottom 0.2 — same totals as dumbbell lateral raise and seated leg curl because each is a short open-chain isolation with brief end-range, not a copied class template.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'machine_hip_abduction',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.7,
    movementPhases: {
      eccentricSeconds: 1.2,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.1,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One abduction + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for machine_hip_abduction; no lab-measured joint angles.',
    techniqueAssumptions:
      'Back against pad; abduct without lifting pelvis per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2000;bottomTransitionSeconds=0.2000;concentricSeconds=1.1000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for machine_hip_abduction under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Machine hip abduction: seated with back against pad, thighs open against resistance, brief, controlled return; bilateral pads, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'machine_leg_press',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.9,
    movementPhases: {
      eccentricSeconds: 1.5,
      bottomTransitionSeconds: 0.15,
      concentricSeconds: 1,
      topTransitionSeconds: 0.25,
    },
    oneRepDefinition: 'One press + controlled return short of stack rest',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for machine_leg_press; no lab-measured joint angles.',
    techniqueAssumptions:
      'Feet on platform; comfortable depth; no knee slam-lock per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5000;bottomTransitionSeconds=0.1500;concentricSeconds=1.0000;topTransitionSeconds=0.2500; secondsPerRep is the arithmetic sum of explicit phases for machine_leg_press under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Machine leg press: feet on platform, controlled knee flexion to comfort, press without hard knee lockout; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'pallof_press_band',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.7,
    movementPhases: {
      eccentricSeconds: 1,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1,
      topTransitionSeconds: 0.5,
    },
    oneRepDefinition: 'One anti-rotation press-out to arms-extended + controlled return to chest',
    unilateralSemantics: 'anti-rotation; side-specific',
    contentVersion: WORKOUT_ENERGY_TIMING_CONTENT_VERSION_FIX_02,
    romAssumptions:
      'ROM follows canonical catalog technique for pallof_press_band; no lab-measured joint angles.',
    techniqueAssumptions:
      'Side-on to band anchor; press forward without trunk turn per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.0000;bottomTransitionSeconds=0.2000;concentricSeconds=1.0000;topTransitionSeconds=0.5000; secondsPerRep is the arithmetic sum of explicit phases for pallof_press_band under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Pallof press (band): stand sideways to anchor, arms press forward while resisting rotation, brief, controlled return to chest; anti-rotation bilateral arm path, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'pec_deck_machine',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3,
    movementPhases: {
      eccentricSeconds: 1.3,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One fly squeeze + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for pec_deck_machine; no lab-measured joint angles.',
    techniqueAssumptions:
      'Back on pad; bring levers together without shoulder overstretch per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.3000;bottomTransitionSeconds=0.2000;concentricSeconds=1.2000;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for pec_deck_machine under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Pec-deck machine: back supported, arms bring pads together in front of chest, brief, controlled open without shoulder overstretch; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'push_ups',
    expectedPublishedRevisionNumber: 2,
    secondsPerRep: 2.8,
    movementPhases: {
      eccentricSeconds: 1.5,
      bottomTransitionSeconds: 0.1,
      concentricSeconds: 1,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One lowering + press to start plank',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for push_ups; no lab-measured joint angles.',
    techniqueAssumptions:
      'Hands under shoulders; rigid trunk line; chest between hands per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5000;bottomTransitionSeconds=0.1000;concentricSeconds=1.0000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for push_ups under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Push-up: hands under shoulders, chest lowers between hands, press up as one rigid line; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'seated_cable_row',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.65,
    movementPhases: {
      eccentricSeconds: 1,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.25,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One pull + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for seated_cable_row; no lab-measured joint angles.',
    techniqueAssumptions:
      'Upright seated torso; start with scapular retraction; pull to abdomen per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.0000;bottomTransitionSeconds=0.2000;concentricSeconds=1.2500;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for seated_cable_row under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Seated cable row: upright torso, handle pulls to abdomen initiating with scapular retraction, brief, controlled return; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'seated_calf_raise_machine',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3.2,
    movementPhases: {
      eccentricSeconds: 1.55,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 0.9,
      topTransitionSeconds: 0.55,
    },
    oneRepDefinition: 'One raise + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for seated_calf_raise_machine; no lab-measured joint angles.',
    techniqueAssumptions:
      'Forefeet on platform; smooth heel rise/lower per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5500;bottomTransitionSeconds=0.2000;concentricSeconds=0.9000;topTransitionSeconds=0.5500; secondsPerRep is the arithmetic sum of explicit phases for seated_calf_raise_machine under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Seated calf-raise machine: forefeet on platform, heels rise smoothly, brief, controlled heel lower; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'seated_leg_curl_machine',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3,
    movementPhases: {
      eccentricSeconds: 1.4,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.2,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One curl + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for seated_leg_curl_machine; no lab-measured joint angles.',
    techniqueAssumptions:
      'Pad above heels; smooth knee flexion without slamming weight per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.4000;bottomTransitionSeconds=0.2000;concentricSeconds=1.2000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for seated_leg_curl_machine under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Seated leg-curl machine: pad above heels, knees flex smoothly, brief, controlled extension return without weight slam. Independent phase analysis yields curl 1.2 / top 0.2 / lower 1.4 / bottom 0.2 — same totals as lateral raise and leg extension from independent isolation timing, not uniqueness padding.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'seated_machine_shoulder_press',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.75,
    movementPhases: {
      eccentricSeconds: 1.2,
      bottomTransitionSeconds: 0.1,
      concentricSeconds: 1.15,
      topTransitionSeconds: 0.3,
    },
    oneRepDefinition: 'One press + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for seated_machine_shoulder_press; no lab-measured joint angles.',
    techniqueAssumptions:
      'Back on pad; press handles up without shoulders to ears per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2000;bottomTransitionSeconds=0.1000;concentricSeconds=1.1500;topTransitionSeconds=0.3000; secondsPerRep is the arithmetic sum of explicit phases for seated_machine_shoulder_press under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Seated machine shoulder press: seat set, back on pad, handles press overhead without shrugging, brief, controlled lower; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'side_lying_clamshell',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.7,
    movementPhases: {
      eccentricSeconds: 1.2,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.1,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One top-knee open + close while pelvis stays stacked',
    unilateralSemantics: 'unilateral (one side per set; no per-rep side switch)',
    romAssumptions:
      'ROM follows canonical catalog technique for side_lying_clamshell; no lab-measured joint angles.',
    techniqueAssumptions:
      'Side-lying bent knees; open top knee with still pelvis per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.2000;bottomTransitionSeconds=0.2000;concentricSeconds=1.1000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for side_lying_clamshell under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Side-lying clamshell: side-lying with bent knees, top knee opens while pelvis stays stacked, brief, controlled close; one side = one rep for the working hip (static side-lying setup — no per-rep sideTransition; other side is a separate set/block).',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'standing_band_row',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.5,
    movementPhases: {
      eccentricSeconds: 1,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.1,
      topTransitionSeconds: 0.2,
    },
    oneRepDefinition: 'One pull + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for standing_band_row; no lab-measured joint angles.',
    techniqueAssumptions:
      'Stable standing stance; pull to lower ribs without torso sway per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.0000;bottomTransitionSeconds=0.2000;concentricSeconds=1.1000;topTransitionSeconds=0.2000; secondsPerRep is the arithmetic sum of explicit phases for standing_band_row under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Standing band row: stable stance, band pulls to lower ribs with still torso, brief, controlled return; bilateral arms, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'standing_calf_raise',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 3.25,
    movementPhases: {
      eccentricSeconds: 1.65,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 0.95,
      topTransitionSeconds: 0.45,
    },
    oneRepDefinition: 'One plantarflexion + return',
    unilateralSemantics: 'bilateral',
    romAssumptions:
      'ROM follows canonical catalog technique for standing_calf_raise; no lab-measured joint angles.',
    techniqueAssumptions:
      'Light support hold; rise on toes then slow heel lower per catalog techniqueRu.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.6500;bottomTransitionSeconds=0.2000;concentricSeconds=0.9500;topTransitionSeconds=0.4500; secondsPerRep is the arithmetic sum of explicit phases for standing_calf_raise under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Standing calf raise: hold support, rise onto toes, longer controlled heel lower to floor; bilateral, no side transition.',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
  draft({
    exerciseKey: 'static_split_squat',
    expectedPublishedRevisionNumber: 1,
    secondsPerRep: 2.9,
    movementPhases: {
      eccentricSeconds: 1.55,
      bottomTransitionSeconds: 0.2,
      concentricSeconds: 1.15,
    },
    oneRepDefinition: 'One descent + ascent while remaining in the same split stance',
    unilateralSemantics: 'static unilateral stance (side change is not a per-rep phase)',
    romAssumptions:
      'ROM follows canonical catalog technique for static_split_squat; no lab-measured joint angles.',
    techniqueAssumptions:
      'Static split stance; pelvis lowers straight down; front foot stays flat (techniqueRu); no per-rep side switch.',
    cadenceAssumptions:
      'Phase model eccentricSeconds=1.5500;bottomTransitionSeconds=0.2000;concentricSeconds=1.1500; secondsPerRep is the arithmetic sum of explicit phases for static_split_squat under internal reviewed tempo — not a universal cadence or family default.',
    rationale:
      'Static split squat: adopt разножка, lower pelvis straight down with front foot flat, drive up; catalog technique keeps the same split stance within each rep — sideTransitionSeconds removed from per-rep phases (set-level side change is out of scope).',
    limitations:
      'INTERNAL_REVIEWED_TEMPO_POLICY estimate only; not laboratory timing, not Compendium cadence, not medical prescription. Actual user tempo may differ.',
  }),
] as const;

export const TIMING_CONTENT_BATCH_02_MAPPINGS: readonly TimingContentEntry[] =
  TIMING_BATCH_02_DRAFTS.map((d) => withTimingChecksum(d));

export const TIMING_CONTENT_BATCH_02_VERSION = WORKOUT_ENERGY_TIMING_CONTENT_VERSION;
export const TIMING_CONTENT_BATCH_02_COUNT = TIMING_CONTENT_BATCH_02_MAPPINGS.length;
