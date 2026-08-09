/**
 * WORKOUT-ENERGY-CONTENT-01B batch-01 — additional APPROVED Compendium mappings.
 * Exact unmodified 2024 Adult Compendium MET values only.
 * Existing 01A pilots remain in energy-content-manifest.ts unchanged.
 */
import { WORKOUT_ENERGY_POLICY_VERSION } from '../workout-energy.types';
import { withEnergyChecksum } from './content-checksum';
import {
  WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
  type CoverageDispositionEntry,
  type EnergyContentEntry,
} from './content.types';

const SOURCE_REFERENCE_BASE =
  'Herrmann SD, Willis EA, Ainsworth BE, et al. 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. J Sport Health Sci. 2024;13(1):6-12. https://pacompendium.com/';
const CONTENT_VERSION = 'workout-energy-content-01b-batch-01';
const SOURCE_VERSION = 'compendium-adult-2024.1';
const REVIEWED_AT = '2026-08-07';
const REVIEWED_BY = 'weight-app-internal-content-review-v1';
const SOURCE_REFERENCE = `${SOURCE_REFERENCE_BASE}\nWA_CONTENT_VERSION_V1=${CONTENT_VERSION}`;

type EnergyDraft = Omit<EnergyContentEntry, 'checksum'>;

function draft(partial: {
  exerciseKey: string;
  expectedPublishedRevisionNumber: number;
  compendiumCode: string;
  metValue: number;
  activityDescriptionEn: string;
  mappingClass: EnergyContentEntry['mappingClass'];
  rationale: string;
  limitations: string;
}): EnergyDraft {
  return {
    exerciseKey: partial.exerciseKey,
    expectedPublishedRevisionNumber: partial.expectedPublishedRevisionNumber,
    catalogReleaseKey: WORKOUT_ENERGY_CATALOG_RELEASE_KEY,
    policyVersion: WORKOUT_ENERGY_POLICY_VERSION,
    populationType: 'ADULT_STANDARD_2024',
    contentVersion: CONTENT_VERSION,
    calculationMethod: 'MET_DURATION',
    compendiumEdition: 'ADULT_2024',
    compendiumCode: partial.compendiumCode,
    metValue: partial.metValue,
    activityDescriptionEn: partial.activityDescriptionEn,
    sourceType: 'COMPENDIUM_ADULT_2024',
    sourceReference: SOURCE_REFERENCE,
    sourceVersion: SOURCE_VERSION,
    mappingClass: partial.mappingClass,
    rationale: partial.rationale,
    limitations: partial.limitations,
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
    status: 'APPROVED',
  };
}

/**
 * Defensible DURATION + REPS mappings for CONTENT-01B batch-01.
 * Codes/MET verified against pacompendium.com (2024 Adult Compendium).
 */
const ENERGY_BATCH_01B_DRAFTS: readonly EnergyDraft[] = [
  // —— DURATION (missing pilots) ——
  draft({
    exerciseKey: 'stretching',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02101',
    metValue: 2.3,
    activityDescriptionEn: 'Stretching, mild',
    mappingClass: 'DIRECT_MAPPING_DEFENSIBLE',
    rationale: 'Catalog stretching maps directly to Compendium stretching, mild (02101).',
    limitations: 'Mild stretching MET; intensity/ROM not user-captured.',
  }),
  draft({
    exerciseKey: 'treadmill_walk',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '17352',
    metValue: 3.5,
    activityDescriptionEn: 'Walking, treadmill, 2.5 to 2.9 mph (4.0 to 4.7 km/h), 0% grade',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Treadmill walk maps to a conservative level treadmill walk band (17352).',
    limitations: 'Assumes ~2.5–2.9 mph / 0% grade; actual treadmill settings unknown.',
  }),
  draft({
    exerciseKey: 'wall_sit',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Wall sit is a light isometric hold; nearest reviewed category is light calisthenics/plank (02024).',
    limitations:
      'Compendium does not name wall sit; isometric quad hold may differ from plank MET.',
  }),
  draft({
    exerciseKey: 'forearm_plank_knees',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Knee-supported forearm plank is a light plank variant under 02024.',
    limitations: 'Knee support may be lower intensity than standard plank in 02024 examples.',
  }),
  draft({
    exerciseKey: 'side_plank_knee',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Side plank (knee) treated as light plank/calisthenics (02024).',
    limitations: 'Side-plank and knee variations are not separately coded in Compendium.',
  }),
  draft({
    exerciseKey: 'side_plank',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Side plank treated as light plank/calisthenics (02024).',
    limitations: 'Side plank is not a distinct Compendium code; uses plank light category.',
  }),
  draft({
    exerciseKey: 'dead_bug_hold',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Dead-bug hold is light core isometric work nearest to 02024.',
    limitations: 'Dead bug is not named in Compendium; hold vs reps not distinguished.',
  }),
  draft({
    exerciseKey: 'suitcase_carry_dumbbell',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '17016',
    metValue: 4.0,
    activityDescriptionEn:
      'Carrying 5 to 14 lb (2.3 to 6.4 kg) load (e.g. suitcase, boxes, groceries), level ground, moderate pace',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Suitcase carry shares the suitcase example in ADL/occupation carrying-load code 17016; retained only as an explicit broad category-level approximation.',
    limitations:
      'BROAD category-level only. Code 17016 describes ADL/occupation carrying (children, groceries, boxes 5–14 lb), not an exercise-specific unilateral gym suitcase carry. Gym load may differ; posture, bracing, and training intent differ from the Compendium activity. MET is not an exercise-specific measurement for suitcase carry; mapping is approximate and category-level.',
  }),
  draft({
    exerciseKey: 'brisk_outdoor_walk',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '17200',
    metValue: 4.8,
    activityDescriptionEn:
      'Walking, 3.5 to 3.9 mph, level, brisk, firm surface, walking for exercise',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Brisk outdoor walk maps to brisk level walking for exercise (17200).',
    limitations: 'Assumes ~3.5–3.9 mph firm level surface; terrain/grade unknown.',
  }),
  draft({
    exerciseKey: 'stationary_bike_easy',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '01210',
    metValue: 3.5,
    activityDescriptionEn: 'Bicycling, stationary, 25-30 watts, very light to light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Easy stationary bike maps to very light–light watt band (01210).',
    limitations: 'Assumes ~25–30 W; bike resistance not user-captured.',
  }),
  draft({
    exerciseKey: 'elliptical_easy',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02048',
    metValue: 5.0,
    activityDescriptionEn: 'Elliptical trainer, moderate effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Elliptical easy uses the only non-vigorous elliptical Compendium code (02048 moderate).',
    limitations:
      'Catalog label is “easy” while 02048 is moderate; no lighter elliptical code exists.',
  }),
  draft({
    exerciseKey: 'cat_cow_flow',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02101',
    metValue: 2.3,
    activityDescriptionEn: 'Stretching, mild',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Cat-cow flow is mild mobility/stretching (02101).',
    limitations: 'Flow cadence may exceed static mild stretching.',
  }),
  draft({
    exerciseKey: 'hip_flexor_stretch',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02101',
    metValue: 2.3,
    activityDescriptionEn: 'Stretching, mild',
    mappingClass: 'DIRECT_MAPPING_DEFENSIBLE',
    rationale: 'Hip-flexor stretch is mild stretching (02101).',
    limitations: 'Single-muscle stretch; MET is category-level.',
  }),
  draft({
    exerciseKey: 'thoracic_opener_open_book',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02101',
    metValue: 2.3,
    activityDescriptionEn: 'Stretching, mild',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Open-book thoracic opener is mild stretching/mobility (02101).',
    limitations: 'Not a named Compendium activity; uses mild stretching category.',
  }),
  draft({
    exerciseKey: 'supine_knee_hugs',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02101',
    metValue: 2.3,
    activityDescriptionEn: 'Stretching, mild',
    mappingClass: 'DIRECT_MAPPING_DEFENSIBLE',
    rationale: 'Supine knee hugs are mild stretching (02101).',
    limitations: 'Very low-intensity stretch; category MET may overestimate.',
  }),
  draft({
    exerciseKey: 'mat_glute_bridge_hold',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Glute-bridge hold is light isometric core/hip work nearest to 02024.',
    limitations: 'Bridge hold is not named in Compendium; not a dynamic bridge MET.',
  }),
  draft({
    exerciseKey: 'ankle_rocks',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02101',
    metValue: 2.3,
    activityDescriptionEn: 'Stretching, mild',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Ankle rocks are mild mobility/stretching (02101).',
    limitations: 'Very localized mobility; category MET is coarse.',
  }),

  // —— REPS (defensible bodyweight / resistance / sit-to-stand) ——
  draft({
    exerciseKey: 'chair_sit_to_stand',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02340',
    metValue: 2.8,
    activityDescriptionEn: 'Sit to stand exercise, 6-12 times/min',
    mappingClass: 'DIRECT_MAPPING_DEFENSIBLE',
    rationale: 'Chair sit-to-stand maps to sit-to-stand exercise (02340).',
    limitations: 'Assumes ~6–12/min cadence band; timing profile still required for REPS energy.',
  }),
  draft({
    exerciseKey: 'box_squat_to_chair',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02340',
    metValue: 2.8,
    activityDescriptionEn: 'Sit to stand exercise, 6-12 times/min',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Box squat to chair is a sit-to-stand pattern under 02340.',
    limitations: 'Box depth/load not in Compendium sit-to-stand row.',
  }),
  draft({
    exerciseKey: 'glute_bridge',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Glute bridge is body-weight resistance general (02056).',
    limitations: 'Bridge not named explicitly; general BW resistance category.',
  }),
  draft({
    exerciseKey: 'dead_bug',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Dead bug is light core calisthenics nearest to 02024.',
    limitations: 'Dead bug not named; light calisthenics category is approximate.',
  }),
  draft({
    exerciseKey: 'knee_push_ups',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02022',
    metValue: 3.8,
    activityDescriptionEn:
      'Calisthenics (e.g., pushups, sit ups, pull-ups, lunges), moderate effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Knee push-ups are a moderated push-up variant under 02022.',
    limitations: 'Knee variation may be easier than standard push-ups in 02022.',
  }),
  draft({
    exerciseKey: 'incline_push_ups',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02022',
    metValue: 3.8,
    activityDescriptionEn:
      'Calisthenics (e.g., pushups, sit ups, pull-ups, lunges), moderate effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Incline push-ups remain push-up calisthenics under 02022.',
    limitations: 'Incline reduces load vs floor push-ups in the same code.',
  }),
  draft({
    exerciseKey: 'band_row',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Band row is resistance training in typical hypertrophy rep ranges (02054).',
    limitations: 'Band resistance not free-weight; 02054 is a broad multi-exercise category.',
  }),
  draft({
    exerciseKey: 'band_pull_apart',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Band pull-apart is light–moderate resistance training (02054).',
    limitations: 'Often lighter than 02054’s varied-resistance framing.',
  }),
  draft({
    exerciseKey: 'goblet_squat',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Goblet squat is resistance training in 8–15 rep contexts (02054).',
    limitations: 'Not the squat/deadlift-specific code 02052; load unknown.',
  }),
  draft({
    exerciseKey: 'machine_leg_press',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Leg press is machine resistance training under 02054.',
    limitations: 'Machine-specific economy not reflected; broad category MET.',
  }),
  draft({
    exerciseKey: 'cable_row',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Cable row is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'chest_press_machine',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Chest press machine is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'barbell_romanian_deadlift',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02052',
    metValue: 5.0,
    activityDescriptionEn:
      'Resistance (weight) training, squats, deadlift, slow or explosive effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Romanian deadlift is a deadlift-pattern lift under 02052.',
    limitations: '02052 includes slow/explosive; RDL tempo/load not specified.',
  }),
  draft({
    exerciseKey: 'lat_pulldown',
    expectedPublishedRevisionNumber: 2,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Lat pulldown is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'dumbbell_romanian_deadlift',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02052',
    metValue: 5.0,
    activityDescriptionEn:
      'Resistance (weight) training, squats, deadlift, slow or explosive effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Dumbbell RDL is a deadlift-pattern lift under 02052.',
    limitations: 'Implement and load differ from barbell deadlift examples.',
  }),
  draft({
    exerciseKey: 'bodyweight_hip_thrust',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Bodyweight hip thrust is BW resistance general (02056).',
    limitations: 'Hip thrust not named in 02056 examples.',
  }),
  draft({
    exerciseKey: 'barbell_hip_thrust',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Loaded hip thrust is resistance training under 02054.',
    limitations: 'Not a hip-thrust-specific Compendium code.',
  }),
  draft({
    exerciseKey: 'good_morning_bodyweight',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Bodyweight good morning is BW resistance general (02056).',
    limitations: 'Hinge pattern not named in 02056 examples.',
  }),
  draft({
    exerciseKey: 'supported_reverse_lunge',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Supported reverse lunge is a lunge variant under 02056.',
    limitations: 'Support reduces demand vs free lunge in the same category.',
  }),
  draft({
    exerciseKey: 'reverse_lunge',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'DIRECT_MAPPING_DEFENSIBLE',
    rationale: 'Reverse lunge is explicitly covered by lunge examples in 02056.',
    limitations: 'General BW resistance; external load not modeled.',
  }),
  draft({
    exerciseKey: 'static_split_squat',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Static split squat is a lunge/squat-family BW resistance move (02056).',
    limitations: 'Isometric pause variants not distinguished.',
  }),
  draft({
    exerciseKey: 'low_step_up',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Low step-up is BW lower-body resistance nearest to 02056.',
    limitations: 'Step height not in Compendium; not stair-climbing codes.',
  }),
  draft({
    exerciseKey: 'dumbbell_step_up',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Dumbbell step-up is loaded resistance training under 02054.',
    limitations: 'Step height/load unknown; broad category MET.',
  }),
  draft({
    exerciseKey: 'dumbbell_floor_press',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Dumbbell floor press is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'barbell_bench_press',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Barbell bench press is resistance training under 02054.',
    limitations: 'Not a bench-specific code; intensity/load unknown.',
  }),
  draft({
    exerciseKey: 'dumbbell_shoulder_press',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Dumbbell shoulder press is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'seated_machine_shoulder_press',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Machine shoulder press is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'band_overhead_press',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Band overhead press is resistance training under 02054.',
    limitations: 'Band resistance curve differs from free weights in 02054 framing.',
  }),
  draft({
    exerciseKey: 'band_face_pull',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Band face pull is resistance training under 02054.',
    limitations: 'Often lighter accessory work than 02054’s varied-resistance framing.',
  }),
  draft({
    exerciseKey: 'seated_cable_row',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Seated cable row is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'chest_supported_dumbbell_row',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Chest-supported DB row is resistance training under 02054.',
    limitations: 'Support reduces stabilizer demand vs free row.',
  }),
  draft({
    exerciseKey: 'barbell_bent_over_row',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Barbell bent-over row is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'assisted_pull_up_machine',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02022',
    metValue: 3.8,
    activityDescriptionEn:
      'Calisthenics (e.g., pushups, sit ups, pull-ups, lunges), moderate effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Assisted pull-up remains a pull-up pattern under moderate calisthenics (02022).',
    limitations: 'Assistance reduces intensity vs free pull-ups listed in 02022.',
  }),
  draft({
    exerciseKey: 'band_lat_pulldown',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Band lat pulldown is resistance training under 02054.',
    limitations: 'Band vs cable machine differences not modeled.',
  }),
  draft({
    exerciseKey: 'bird_dog',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Bird dog is light core calisthenics nearest to 02024.',
    limitations: 'Bird dog not named in Compendium.',
  }),
  draft({
    exerciseKey: 'pallof_press_band',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale:
      'Pallof press is anti-rotation resistance work retained only as a broad 02054 category approximation with explicit isometric limitation.',
    limitations:
      'BROAD only: code 02054 is a general vigorous/multi-exercise resistance-training category, not Pallof-press-specific and not a measurement of isometric anti-rotation bracing. MET does not isolate static core anti-rotation demand; often isometric/bracing while 02054 assumes 8–15 rep resistance sets.',
  }),
  draft({
    exerciseKey: 'heel_taps',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02024',
    metValue: 2.8,
    activityDescriptionEn:
      'Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Heel taps are light abdominal calisthenics under 02024.',
    limitations: 'Not a named activity; light calisthenics category is approximate.',
  }),
  draft({
    exerciseKey: 'side_lying_clamshell',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Clamshell is light BW hip resistance nearest to 02056.',
    limitations: 'Very localized; general BW resistance may overestimate.',
  }),
  draft({
    exerciseKey: 'glute_bridge_march',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Glute-bridge march is BW resistance/core work under 02056.',
    limitations: 'March variant not named; category MET is approximate.',
  }),
  draft({
    exerciseKey: 'standing_calf_raise',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02056',
    metValue: 3.0,
    activityDescriptionEn:
      'Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Standing calf raise (BW) is BW resistance general (02056).',
    limitations: 'Calf raise not named; localized demand may be lower.',
  }),
  draft({
    exerciseKey: 'seated_calf_raise_machine',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Seated calf raise machine is resistance training under 02054.',
    limitations: 'Localized machine work; broad category MET.',
  }),
  draft({
    exerciseKey: 'seated_leg_curl_machine',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Seated leg curl is machine resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'leg_extension_machine',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Leg extension is machine resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'cable_chest_press',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Cable chest press is resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'pec_deck_machine',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Pec deck is machine resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'lat_pulldown_neutral_grip',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Neutral-grip lat pulldown is resistance training under 02054.',
    limitations: 'Grip variant not separately coded.',
  }),
  draft({
    exerciseKey: 'band_squat',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Band squat is resistance training under 02054.',
    limitations: 'Band resistance curve differs from free-weight squat codes.',
  }),
  draft({
    exerciseKey: 'band_glute_bridge',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Band glute bridge is resistance training under 02054.',
    limitations: 'Broad category; band load unknown.',
  }),
  draft({
    exerciseKey: 'band_chest_press',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Band chest press is resistance training under 02054.',
    limitations: 'Band vs free-weight differences not modeled.',
  }),
  draft({
    exerciseKey: 'dumbbell_goblet_split_squat',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'DB goblet split squat is loaded resistance training under 02054.',
    limitations: 'Broad multi-exercise resistance category.',
  }),
  draft({
    exerciseKey: 'dumbbell_lateral_raise',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Dumbbell lateral raise is resistance training under 02054.',
    limitations: 'Isolation raise may be lighter than 02054 framing.',
  }),
  draft({
    exerciseKey: 'machine_hip_abduction',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Hip abduction machine is resistance training under 02054.',
    limitations: 'Localized machine work; broad category MET.',
  }),
  draft({
    exerciseKey: 'back_extension_machine',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Back extension machine is resistance training under 02054.',
    limitations: 'Could alternatively map to light back-exercise calisthenics; 02054 chosen for machine load.',
  }),
  draft({
    exerciseKey: 'standing_band_row',
    expectedPublishedRevisionNumber: 1,
    compendiumCode: '02054',
    metValue: 3.5,
    activityDescriptionEn:
      'Resistance (weight) training, multiple exercises, 8-15 reps at varied resistance',
    mappingClass: 'BROAD_MAPPING_WITH_EXPLICIT_LIMITATION',
    rationale: 'Standing band row is resistance training under 02054.',
    limitations: 'Band resistance curve differs from free weights.',
  }),
] as const;

export const ENERGY_CONTENT_BATCH_01B_MAPPINGS: readonly EnergyContentEntry[] =
  ENERGY_BATCH_01B_DRAFTS.map((d) => withEnergyChecksum(d));

export const ENERGY_CONTENT_BATCH_01B_VERSION = CONTENT_VERSION;
export const ENERGY_CONTENT_BATCH_01B_REVIEWED_BY = REVIEWED_BY;
export const ENERGY_CONTENT_BATCH_01B_REVIEWED_AT = REVIEWED_AT;

/** Explicit non-mapping dispositions for pins without a defensible Compendium row. */
export const ENERGY_CONTENT_BATCH_01B_DISPOSITIONS: readonly CoverageDispositionEntry[] = [
  {
    exerciseKey: 'diaphragmatic_breathing',
    expectedPublishedRevisionNumber: 1,
    disposition: 'NO_DEFENSIBLE_MAPPING',
    reason:
      'NO_DEFENSIBLE_MAPPING — no Adult 2024 Compendium code uniquely describes diaphragmatic breathing / breathwork without inventing or averaging METs; left unmapped rather than force a stretch/yoga surrogate.',
  },
  {
    exerciseKey: 'farmer_carry_dumbbell',
    expectedPublishedRevisionNumber: 1,
    disposition: 'NO_DEFENSIBLE_MAPPING',
    reason:
      'NO_DEFENSIBLE_MAPPING — Adult 2024 Compendium code 17016 describes ADL/occupation carrying (children, groceries, boxes) in a 5–14 lb range, not an exercise-specific gym farmer carry. Load, posture, intent, and protocol differ; a broad limitation is insufficient to defend MET 4.0 as farmer-carry energy content. Left unmapped rather than force a weak carrying surrogate.',
  },
  {
    exerciseKey: 'band_lateral_walk',
    expectedPublishedRevisionNumber: 1,
    disposition: 'NO_DEFENSIBLE_MAPPING',
    reason:
      'NO_DEFENSIBLE_MAPPING — code 02054 is a general multi-exercise resistance-training category and does not honestly describe resisted lateral locomotion/walking; no exact official 2024 locomotion code was found that defends band lateral walk without inventing coverage. Left unmapped rather than use a generic resistance category for coverage.',
  },
  {
    exerciseKey: 'seated_march',
    expectedPublishedRevisionNumber: 1,
    disposition: 'NO_DEFENSIBLE_MAPPING',
    reason:
      'NO_DEFENSIBLE_MAPPING — code 02140 is a video/TV light conditioning category and does not reflect seated-march exercise movement or intensity; seated posture alone is not a defensible basis. Left unmapped rather than use a screen-activity surrogate.',
  },
  {
    exerciseKey: 'wall_angels',
    expectedPublishedRevisionNumber: 1,
    disposition: 'UNSUPPORTED_REPS_OR_DURATION',
    reason:
      'WALL_ANGELS_PUBLICATION_BLOCKED — product target REPS, but same-code re-pin of workout-catalog-canonical-01b is impossible without rewriting shipped migration 211 or a new catalog republish path; coverage remains UNSUPPORTED_REPS_OR_DURATION.',
  },
] as const;
