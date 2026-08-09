/**
 * One-shot helper to emit catalog-manifest.ts for WORKOUT-CATALOG-01A.
 * Run: node apps/api/scripts/generate-catalog-manifest-01a.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @typedef {'HOME'|'GYM'} Place */
/** @typedef {'BEGINNER'|'INTERMEDIATE'|'ADVANCED'} Level */

/**
 * @param {object} p
 * @param {number} p.ordinal
 * @param {string} p.slug
 * @param {string} p.familySlug
 * @param {string} p.nameRu
 * @param {string} p.nameEn
 * @param {Level} p.minLevel
 * @param {Place[]} p.supportedPlaces
 * @param {string[]} p.requiredEquipment
 * @param {string[]} [p.optionalEquipment]
 * @param {string} p.movementPattern
 * @param {string[]} p.primaryMuscleGroups
 * @param {string[]} [p.secondaryMuscleGroups]
 * @param {'REPS'|'DURATION'|'REPS_OR_DURATION'} [p.repetitionMode]
 * @param {'LOW'|'MODERATE'|'HIGH'} [p.impactLevel]
 * @param {'LOW'|'MODERATE'|'HIGH'} [p.balanceRequirement]
 * @param {boolean} [p.floorRequired]
 * @param {boolean} [p.overheadMovement]
 * @param {boolean} [p.deepKneeFlexion]
 * @param {boolean} [p.singleLeg]
 * @param {boolean} [p.beginnerAllowed]
 * @param {'EXISTING_APPROVED'|'PLANNED_FOR_01B'} p.initialCatalogStatus
 * @param {string|null} [p.legacyExerciseKey]
 */
function e(p) {
  const allowed = p.beginnerAllowed !== undefined ? p.beginnerAllowed : p.minLevel === 'BEGINNER';
  return {
    ordinal: p.ordinal,
    slug: p.slug,
    familySlug: p.familySlug,
    nameRu: p.nameRu,
    nameEn: p.nameEn,
    minLevel: p.minLevel,
    supportedPlaces: p.supportedPlaces,
    requiredEquipment: p.requiredEquipment,
    optionalEquipment: p.optionalEquipment ?? [],
    movementPattern: p.movementPattern,
    primaryMuscleGroups: p.primaryMuscleGroups,
    secondaryMuscleGroups: p.secondaryMuscleGroups ?? [],
    repetitionMode: p.repetitionMode ?? 'REPS',
    impactLevel: p.impactLevel ?? 'LOW',
    balanceRequirement: p.balanceRequirement ?? 'LOW',
    floorRequired: p.floorRequired ?? false,
    overheadMovement: p.overheadMovement ?? false,
    deepKneeFlexion: p.deepKneeFlexion ?? false,
    singleLeg: p.singleLeg ?? false,
    beginnerAllowed: allowed,
    initialCatalogStatus: p.initialCatalogStatus,
    plannedContentPackage:
      p.initialCatalogStatus === 'EXISTING_APPROVED' ? 'EXISTING' : 'WORKOUT_CATALOG_01B',
    legacyExerciseKey:
      p.legacyExerciseKey !== undefined
        ? p.legacyExerciseKey
        : p.initialCatalogStatus === 'EXISTING_APPROVED'
          ? p.slug
          : null,
  };
}

const existing = [
  e({ ordinal: 1, slug: 'morning_walk', familySlug: 'outdoor_walk', nameRu: 'Утренняя ходьба', nameEn: 'Morning walk', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['NONE'], movementPattern: 'low_impact_conditioning', primaryMuscleGroups: ['cardio'], repetitionMode: 'DURATION', initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 2, slug: 'bodyweight_squats', familySlug: 'bodyweight_squat', nameRu: 'Приседания с весом тела', nameEn: 'Bodyweight squats', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], movementPattern: 'squat', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 3, slug: 'stretching', familySlug: 'gentle_stretch', nameRu: 'Растяжка', nameEn: 'Stretching', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['NONE'], optionalEquipment: ['MAT'], movementPattern: 'mobility', primaryMuscleGroups: ['mobility'], repetitionMode: 'DURATION', initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 4, slug: 'light_jog', familySlug: 'easy_jog', nameRu: 'Лёгкий бег', nameEn: 'Light jog', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME'], requiredEquipment: ['NONE'], movementPattern: 'low_impact_conditioning', primaryMuscleGroups: ['cardio'], repetitionMode: 'DURATION', impactLevel: 'MODERATE', beginnerAllowed: false, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 5, slug: 'core_plank', familySlug: 'plank', nameRu: 'Планка', nameEn: 'Core plank', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'anti_extension_core', primaryMuscleGroups: ['core'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 6, slug: 'mobility_flow', familySlug: 'mobility_flow', nameRu: 'Комплекс на подвижность', nameEn: 'Mobility flow', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['NONE'], optionalEquipment: ['MAT'], movementPattern: 'mobility', primaryMuscleGroups: ['mobility'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 7, slug: 'recovery_walk', familySlug: 'recovery_walk', nameRu: 'Восстановительная ходьба', nameEn: 'Recovery walk', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['NONE'], movementPattern: 'recovery', primaryMuscleGroups: ['cardio'], repetitionMode: 'DURATION', initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 8, slug: 'push_ups', familySlug: 'push_up', nameRu: 'Отжимания', nameEn: 'Push-ups', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest', 'triceps'], secondaryMuscleGroups: ['shoulders'], floorRequired: true, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 9, slug: 'glute_bridge', familySlug: 'glute_bridge', nameRu: 'Ягодичный мост', nameEn: 'Glute bridge', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'hinge', primaryMuscleGroups: ['glutes', 'hamstrings'], floorRequired: true, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 10, slug: 'dead_bug', familySlug: 'dead_bug', nameRu: 'Жук на спине', nameEn: 'Dead bug', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'anti_extension_core', primaryMuscleGroups: ['core'], floorRequired: true, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 11, slug: 'band_row', familySlug: 'band_row', nameRu: 'Тяга эспандера', nameEn: 'Band row', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['back', 'biceps'], initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 12, slug: 'band_pull_apart', familySlug: 'band_pull_apart', nameRu: 'Разведение эспандера', nameEn: 'Band pull-apart', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['upper_back', 'rear_delts'], initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 13, slug: 'dumbbell_row', familySlug: 'dumbbell_row', nameRu: 'Тяга гантели', nameEn: 'Dumbbell row', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], optionalEquipment: ['BENCH'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['back', 'biceps'], beginnerAllowed: false, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 14, slug: 'goblet_squat', familySlug: 'goblet_squat', nameRu: 'Приседание с гантелью', nameEn: 'Goblet squat', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], movementPattern: 'squat', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, beginnerAllowed: false, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 15, slug: 'machine_leg_press', familySlug: 'leg_press', nameRu: 'Жим ногами в тренажёре', nameEn: 'Machine leg press', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'squat', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 16, slug: 'cable_row', familySlug: 'cable_row', nameRu: 'Тяга нижнего блока', nameEn: 'Cable row', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['back', 'biceps'], initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 17, slug: 'treadmill_walk', familySlug: 'treadmill_walk', nameRu: 'Ходьба на дорожке', nameEn: 'Treadmill walk', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['CARDIO_MACHINE'], movementPattern: 'low_impact_conditioning', primaryMuscleGroups: ['cardio'], repetitionMode: 'DURATION', initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 18, slug: 'chest_press_machine', familySlug: 'chest_press_machine', nameRu: 'Жим от груди в тренажёре', nameEn: 'Machine chest press', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest', 'triceps'], initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 19, slug: 'barbell_romanian_deadlift', familySlug: 'romanian_deadlift', nameRu: 'Румынская тяга со штангой', nameEn: 'Barbell Romanian deadlift', minLevel: 'INTERMEDIATE', supportedPlaces: ['GYM'], requiredEquipment: ['BARBELL'], movementPattern: 'hinge', primaryMuscleGroups: ['hamstrings', 'glutes'], beginnerAllowed: false, initialCatalogStatus: 'EXISTING_APPROVED' }),
  e({ ordinal: 20, slug: 'lat_pulldown', familySlug: 'lat_pulldown', nameRu: 'Тяга верхнего блока', nameEn: 'Lat pulldown', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'vertical_pull', primaryMuscleGroups: ['back', 'biceps'], initialCatalogStatus: 'EXISTING_APPROVED' }),
];

const planned = [
  // squat / chair / wall
  e({ ordinal: 21, slug: 'chair_sit_to_stand', familySlug: 'chair_squat', nameRu: 'Вставание со стула', nameEn: 'Chair sit-to-stand', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['CHAIR'], movementPattern: 'squat', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 22, slug: 'wall_sit', familySlug: 'wall_sit', nameRu: 'Присед у стены', nameEn: 'Wall sit', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], movementPattern: 'squat', primaryMuscleGroups: ['quads'], repetitionMode: 'DURATION', deepKneeFlexion: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 23, slug: 'box_squat_to_chair', familySlug: 'bodyweight_squat', nameRu: 'Приседание на стул', nameEn: 'Box squat to chair', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['CHAIR'], movementPattern: 'squat', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // hinge / hip thrust / RDL variants
  e({ ordinal: 24, slug: 'dumbbell_romanian_deadlift', familySlug: 'romanian_deadlift', nameRu: 'Румынская тяга с гантелями', nameEn: 'Dumbbell Romanian deadlift', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], movementPattern: 'hinge', primaryMuscleGroups: ['hamstrings', 'glutes'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 25, slug: 'bodyweight_hip_thrust', familySlug: 'hip_thrust', nameRu: 'Ягодичный толчок с весом тела', nameEn: 'Bodyweight hip thrust', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['BENCH', 'MAT'], movementPattern: 'glute_isolation', primaryMuscleGroups: ['glutes'], floorRequired: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 26, slug: 'barbell_hip_thrust', familySlug: 'hip_thrust', nameRu: 'Ягодичный толчок со штангой', nameEn: 'Barbell hip thrust', minLevel: 'ADVANCED', supportedPlaces: ['GYM'], requiredEquipment: ['BARBELL', 'BENCH'], movementPattern: 'glute_isolation', primaryMuscleGroups: ['glutes'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 27, slug: 'good_morning_bodyweight', familySlug: 'good_morning', nameRu: 'Наклон «доброе утро» без веса', nameEn: 'Bodyweight good morning', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], movementPattern: 'hinge', primaryMuscleGroups: ['hamstrings', 'glutes'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // lunge / step
  e({ ordinal: 28, slug: 'supported_reverse_lunge', familySlug: 'reverse_lunge', nameRu: 'Выпад назад с опорой', nameEn: 'Supported reverse lunge', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['CHAIR'], movementPattern: 'lunge', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, singleLeg: true, balanceRequirement: 'MODERATE', initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 29, slug: 'reverse_lunge', familySlug: 'reverse_lunge', nameRu: 'Выпад назад', nameEn: 'Reverse lunge', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], movementPattern: 'lunge', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, singleLeg: true, balanceRequirement: 'MODERATE', beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 30, slug: 'static_split_squat', familySlug: 'split_squat', nameRu: 'Статический сплит-присед', nameEn: 'Static split squat', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], movementPattern: 'lunge', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, singleLeg: true, balanceRequirement: 'MODERATE', beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 31, slug: 'low_step_up', familySlug: 'step_up', nameRu: 'Шаг на низкую платформу', nameEn: 'Low step-up', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BENCH'], optionalEquipment: ['CHAIR'], movementPattern: 'lunge', primaryMuscleGroups: ['quads', 'glutes'], singleLeg: true, balanceRequirement: 'MODERATE', initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 32, slug: 'dumbbell_step_up', familySlug: 'step_up', nameRu: 'Шаг на платформу с гантелями', nameEn: 'Dumbbell step-up', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL', 'BENCH'], movementPattern: 'lunge', primaryMuscleGroups: ['quads', 'glutes'], singleLeg: true, balanceRequirement: 'MODERATE', beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // horizontal / vertical push
  e({ ordinal: 33, slug: 'knee_push_ups', familySlug: 'push_up', nameRu: 'Отжимания с колен', nameEn: 'Knee push-ups', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest', 'triceps'], floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 34, slug: 'incline_push_ups', familySlug: 'push_up', nameRu: 'Отжимания с опорой', nameEn: 'Incline push-ups', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['BENCH', 'CHAIR'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest', 'triceps'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 35, slug: 'dumbbell_floor_press', familySlug: 'dumbbell_press', nameRu: 'Жим гантелей лёжа на полу', nameEn: 'Dumbbell floor press', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], optionalEquipment: ['MAT'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest', 'triceps'], floorRequired: true, beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 36, slug: 'barbell_bench_press', familySlug: 'bench_press', nameRu: 'Жим штанги лёжа', nameEn: 'Barbell bench press', minLevel: 'ADVANCED', supportedPlaces: ['GYM'], requiredEquipment: ['BARBELL', 'BENCH'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest', 'triceps'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 37, slug: 'dumbbell_shoulder_press', familySlug: 'shoulder_press', nameRu: 'Жим гантелей стоя/сидя', nameEn: 'Dumbbell shoulder press', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], movementPattern: 'vertical_push', primaryMuscleGroups: ['shoulders', 'triceps'], overheadMovement: true, beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 38, slug: 'seated_machine_shoulder_press', familySlug: 'shoulder_press', nameRu: 'Жим плеч в тренажёре', nameEn: 'Seated machine shoulder press', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'vertical_push', primaryMuscleGroups: ['shoulders', 'triceps'], overheadMovement: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 39, slug: 'band_overhead_press', familySlug: 'shoulder_press', nameRu: 'Жим эспандера вверх', nameEn: 'Band overhead press', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'vertical_push', primaryMuscleGroups: ['shoulders', 'triceps'], overheadMovement: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // pull variants
  e({ ordinal: 40, slug: 'band_face_pull', familySlug: 'face_pull', nameRu: 'Тяга эспандера к лицу', nameEn: 'Band face pull', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['upper_back', 'rear_delts'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 41, slug: 'seated_cable_row', familySlug: 'cable_row', nameRu: 'Тяга нижнего блока сидя', nameEn: 'Seated cable row', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['CABLE'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['back', 'biceps'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 42, slug: 'chest_supported_dumbbell_row', familySlug: 'dumbbell_row', nameRu: 'Тяга гантелей с опорой груди', nameEn: 'Chest-supported dumbbell row', minLevel: 'INTERMEDIATE', supportedPlaces: ['GYM'], requiredEquipment: ['DUMBBELL', 'BENCH'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['back', 'biceps'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 43, slug: 'barbell_bent_over_row', familySlug: 'barbell_row', nameRu: 'Тяга штанги в наклоне', nameEn: 'Barbell bent-over row', minLevel: 'ADVANCED', supportedPlaces: ['GYM'], requiredEquipment: ['BARBELL'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['back', 'biceps'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 44, slug: 'assisted_pull_up_machine', familySlug: 'lat_pulldown', nameRu: 'Подтягивания в гравитроне', nameEn: 'Assisted pull-up machine', minLevel: 'INTERMEDIATE', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'vertical_pull', primaryMuscleGroups: ['back', 'biceps'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 45, slug: 'band_lat_pulldown', familySlug: 'lat_pulldown', nameRu: 'Тяга эспандера сверху', nameEn: 'Band lat pulldown', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'vertical_pull', primaryMuscleGroups: ['back', 'biceps'], overheadMovement: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // core
  e({ ordinal: 46, slug: 'forearm_plank_knees', familySlug: 'plank', nameRu: 'Планка на предплечьях с колен', nameEn: 'Forearm plank on knees', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'anti_extension_core', primaryMuscleGroups: ['core'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 47, slug: 'bird_dog', familySlug: 'bird_dog', nameRu: 'Птица-собака', nameEn: 'Bird dog', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'anti_extension_core', primaryMuscleGroups: ['core'], floorRequired: true, balanceRequirement: 'MODERATE', initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 48, slug: 'side_plank_knee', familySlug: 'side_plank', nameRu: 'Боковая планка с опорой на колено', nameEn: 'Side plank on knee', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'lateral_core', primaryMuscleGroups: ['core'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 49, slug: 'side_plank', familySlug: 'side_plank', nameRu: 'Боковая планка', nameEn: 'Side plank', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'lateral_core', primaryMuscleGroups: ['core'], repetitionMode: 'DURATION', floorRequired: true, beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 50, slug: 'pallof_press_band', familySlug: 'anti_rotation', nameRu: 'Жим Паллофа с эспандером', nameEn: 'Band Pallof press', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'anti_rotation_core', primaryMuscleGroups: ['core'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 51, slug: 'heel_taps', familySlug: 'dead_bug', nameRu: 'Касания пяток лёжа', nameEn: 'Heel taps', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'anti_extension_core', primaryMuscleGroups: ['core'], floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 52, slug: 'dead_bug_hold', familySlug: 'dead_bug', nameRu: 'Удержание «жука»', nameEn: 'Dead bug hold', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'anti_extension_core', primaryMuscleGroups: ['core'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // glute isolation / hip
  e({ ordinal: 53, slug: 'side_lying_clamshell', familySlug: 'hip_abduction', nameRu: 'Ракушка лёжа на боку', nameEn: 'Side-lying clamshell', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT', 'RESISTANCE_BAND'], movementPattern: 'glute_isolation', primaryMuscleGroups: ['glutes'], floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 54, slug: 'band_lateral_walk', familySlug: 'hip_abduction', nameRu: 'Боковая ходьба с эспандером', nameEn: 'Band lateral walk', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'glute_isolation', primaryMuscleGroups: ['glutes'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 55, slug: 'glute_bridge_march', familySlug: 'glute_bridge', nameRu: 'Ягодичный мост с маршем', nameEn: 'Glute bridge march', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'glute_isolation', primaryMuscleGroups: ['glutes'], floorRequired: true, singleLeg: true, balanceRequirement: 'MODERATE', beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // calf
  e({ ordinal: 56, slug: 'standing_calf_raise', familySlug: 'calf_raise', nameRu: 'Подъём на носки стоя', nameEn: 'Standing calf raise', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['DUMBBELL'], movementPattern: 'calf', primaryMuscleGroups: ['calves'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 57, slug: 'seated_calf_raise_machine', familySlug: 'calf_raise', nameRu: 'Подъём на носки сидя в тренажёре', nameEn: 'Seated calf raise machine', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'calf', primaryMuscleGroups: ['calves'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // carry
  e({ ordinal: 58, slug: 'farmer_carry_dumbbell', familySlug: 'farmer_carry', nameRu: 'Прогулка фермера с гантелями', nameEn: 'Dumbbell farmer carry', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], movementPattern: 'carry', primaryMuscleGroups: ['grip', 'core'], secondaryMuscleGroups: ['shoulders'], repetitionMode: 'DURATION', beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 59, slug: 'suitcase_carry_dumbbell', familySlug: 'farmer_carry', nameRu: 'Перенос гантели в одной руке', nameEn: 'Dumbbell suitcase carry', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], movementPattern: 'carry', primaryMuscleGroups: ['core', 'grip'], repetitionMode: 'DURATION', beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // conditioning / recovery / mobility
  e({ ordinal: 60, slug: 'brisk_outdoor_walk', familySlug: 'outdoor_walk', nameRu: 'Быстрая прогулка', nameEn: 'Brisk outdoor walk', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['NONE'], movementPattern: 'low_impact_conditioning', primaryMuscleGroups: ['cardio'], repetitionMode: 'DURATION', impactLevel: 'MODERATE', initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 61, slug: 'stationary_bike_easy', familySlug: 'bike_conditioning', nameRu: 'Велотренажёр в спокойном темпе', nameEn: 'Easy stationary bike', minLevel: 'BEGINNER', supportedPlaces: ['GYM', 'HOME'], requiredEquipment: ['CARDIO_MACHINE'], movementPattern: 'low_impact_conditioning', primaryMuscleGroups: ['cardio'], repetitionMode: 'DURATION', initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 62, slug: 'elliptical_easy', familySlug: 'elliptical_conditioning', nameRu: 'Эллипсоид в спокойном темпе', nameEn: 'Easy elliptical', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['CARDIO_MACHINE'], movementPattern: 'low_impact_conditioning', primaryMuscleGroups: ['cardio'], repetitionMode: 'DURATION', initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 63, slug: 'seated_march', familySlug: 'chair_conditioning', nameRu: 'Марш сидя', nameEn: 'Seated march', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['CHAIR'], movementPattern: 'low_impact_conditioning', primaryMuscleGroups: ['cardio', 'hip_flexors'], repetitionMode: 'DURATION', initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 64, slug: 'cat_cow_flow', familySlug: 'mobility_flow', nameRu: 'Кошка-корова', nameEn: 'Cat-cow flow', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['NONE'], optionalEquipment: ['MAT'], movementPattern: 'mobility', primaryMuscleGroups: ['mobility'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 65, slug: 'hip_flexor_stretch', familySlug: 'gentle_stretch', nameRu: 'Растяжка сгибателей бедра', nameEn: 'Hip flexor stretch', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['NONE'], optionalEquipment: ['MAT'], movementPattern: 'mobility', primaryMuscleGroups: ['hip_flexors'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 66, slug: 'thoracic_opener_open_book', familySlug: 'gentle_stretch', nameRu: 'Раскрытие груди «открытая книга»', nameEn: 'Thoracic opener open book', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['NONE'], optionalEquipment: ['MAT'], movementPattern: 'mobility', primaryMuscleGroups: ['upper_back'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 67, slug: 'diaphragmatic_breathing', familySlug: 'recovery_breath', nameRu: 'Диафрагмальное дыхание', nameEn: 'Diaphragmatic breathing', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['NONE'], optionalEquipment: ['MAT'], movementPattern: 'recovery', primaryMuscleGroups: ['recovery'], repetitionMode: 'DURATION', floorRequired: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 68, slug: 'supine_knee_hugs', familySlug: 'recovery_mobility', nameRu: 'Подтягивание коленей лёжа', nameEn: 'Supine knee hugs', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['NONE'], optionalEquipment: ['MAT'], movementPattern: 'recovery', primaryMuscleGroups: ['mobility'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // gym machines extras
  e({ ordinal: 69, slug: 'seated_leg_curl_machine', familySlug: 'leg_curl', nameRu: 'Сгибание ног сидя', nameEn: 'Seated leg curl machine', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'hinge', primaryMuscleGroups: ['hamstrings'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 70, slug: 'leg_extension_machine', familySlug: 'leg_extension', nameRu: 'Разгибание ног в тренажёре', nameEn: 'Leg extension machine', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'squat', primaryMuscleGroups: ['quads'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 71, slug: 'cable_chest_press', familySlug: 'cable_press', nameRu: 'Жим от груди на блоке', nameEn: 'Cable chest press', minLevel: 'INTERMEDIATE', supportedPlaces: ['GYM'], requiredEquipment: ['CABLE'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest', 'triceps'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 72, slug: 'pec_deck_machine', familySlug: 'chest_fly_machine', nameRu: 'Сведение рук в тренажёре', nameEn: 'Pec deck machine', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 73, slug: 'lat_pulldown_neutral_grip', familySlug: 'lat_pulldown', nameRu: 'Тяга верхнего блока нейтральным хватом', nameEn: 'Neutral-grip lat pulldown', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'vertical_pull', primaryMuscleGroups: ['back', 'biceps'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  // band / home extras
  e({ ordinal: 74, slug: 'band_squat', familySlug: 'band_squat', nameRu: 'Приседание с эспандером', nameEn: 'Band squat', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'squat', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 75, slug: 'band_glute_bridge', familySlug: 'glute_bridge', nameRu: 'Ягодичный мост с эспандером', nameEn: 'Band glute bridge', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['RESISTANCE_BAND'], optionalEquipment: ['MAT'], movementPattern: 'glute_isolation', primaryMuscleGroups: ['glutes'], floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 76, slug: 'band_chest_press', familySlug: 'band_press', nameRu: 'Жим эспандера от груди', nameEn: 'Band chest press', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'horizontal_push', primaryMuscleGroups: ['chest', 'triceps'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 77, slug: 'dumbbell_goblet_split_squat', familySlug: 'split_squat', nameRu: 'Сплит-присед с гантелью у груди', nameEn: 'Goblet split squat', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], movementPattern: 'lunge', primaryMuscleGroups: ['quads', 'glutes'], deepKneeFlexion: true, singleLeg: true, balanceRequirement: 'MODERATE', beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 78, slug: 'dumbbell_lateral_raise', familySlug: 'lateral_raise', nameRu: 'Разведение гантелей в стороны', nameEn: 'Dumbbell lateral raise', minLevel: 'INTERMEDIATE', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['DUMBBELL'], movementPattern: 'vertical_push', primaryMuscleGroups: ['shoulders'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 79, slug: 'machine_hip_abduction', familySlug: 'hip_abduction', nameRu: 'Отведение бедра в тренажёре', nameEn: 'Machine hip abduction', minLevel: 'BEGINNER', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'glute_isolation', primaryMuscleGroups: ['glutes'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 80, slug: 'back_extension_machine', familySlug: 'back_extension', nameRu: 'Гиперэкстензия в тренажёре', nameEn: 'Back extension machine', minLevel: 'INTERMEDIATE', supportedPlaces: ['GYM'], requiredEquipment: ['GYM_MACHINES'], movementPattern: 'hinge', primaryMuscleGroups: ['erectors', 'glutes'], beginnerAllowed: false, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 81, slug: 'standing_band_row', familySlug: 'band_row', nameRu: 'Тяга эспандера стоя', nameEn: 'Standing band row', minLevel: 'BEGINNER', supportedPlaces: ['HOME'], requiredEquipment: ['RESISTANCE_BAND'], movementPattern: 'horizontal_pull', primaryMuscleGroups: ['back', 'biceps'], initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 82, slug: 'mat_glute_bridge_hold', familySlug: 'glute_bridge', nameRu: 'Удержание ягодичного моста', nameEn: 'Glute bridge hold', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], optionalEquipment: ['MAT'], movementPattern: 'glute_isolation', primaryMuscleGroups: ['glutes'], repetitionMode: 'DURATION', floorRequired: true, initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 83, slug: 'wall_angels', familySlug: 'shoulder_mobility', nameRu: 'Ангелы у стены', nameEn: 'Wall angels', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['BODYWEIGHT'], movementPattern: 'mobility', primaryMuscleGroups: ['upper_back', 'shoulders'], repetitionMode: 'REPS_OR_DURATION', initialCatalogStatus: 'PLANNED_FOR_01B' }),
  e({ ordinal: 84, slug: 'ankle_rocks', familySlug: 'ankle_mobility', nameRu: 'Покачивания в голеностопе', nameEn: 'Ankle rocks', minLevel: 'BEGINNER', supportedPlaces: ['HOME', 'GYM'], requiredEquipment: ['NONE'], optionalEquipment: ['MAT'], movementPattern: 'mobility', primaryMuscleGroups: ['ankles'], repetitionMode: 'DURATION', initialCatalogStatus: 'PLANNED_FOR_01B' }),
];

/** Consolidate to 35–40 families without changing slugs/ordinals. */
const FAMILY_REMAP = {
  outdoor_walk: 'outdoor_walk',
  recovery_walk: 'outdoor_walk',
  bodyweight_squat: 'bodyweight_squat',
  chair_squat: 'bodyweight_squat',
  wall_sit: 'bodyweight_squat',
  band_squat: 'bodyweight_squat',
  gentle_stretch: 'gentle_stretch',
  shoulder_mobility: 'gentle_stretch',
  ankle_mobility: 'gentle_stretch',
  recovery_mobility: 'gentle_stretch',
  easy_jog: 'easy_jog',
  plank: 'plank',
  mobility_flow: 'mobility_flow',
  push_up: 'push_up',
  glute_bridge: 'glute_bridge',
  dead_bug: 'dead_bug',
  band_row: 'band_row',
  band_pull_apart: 'band_pull_apart',
  face_pull: 'band_pull_apart',
  dumbbell_row: 'dumbbell_row',
  goblet_squat: 'goblet_squat',
  leg_press: 'leg_press',
  leg_extension: 'leg_press',
  cable_row: 'cable_row',
  treadmill_walk: 'treadmill_walk',
  chest_press_machine: 'chest_press_machine',
  chest_fly_machine: 'chest_press_machine',
  cable_press: 'chest_press_machine',
  romanian_deadlift: 'romanian_deadlift',
  good_morning: 'romanian_deadlift',
  back_extension: 'romanian_deadlift',
  lat_pulldown: 'lat_pulldown',
  hip_thrust: 'hip_thrust',
  reverse_lunge: 'lunge_split',
  split_squat: 'lunge_split',
  step_up: 'step_up',
  dumbbell_press: 'dumbbell_press',
  bench_press: 'bench_press',
  shoulder_press: 'shoulder_press',
  lateral_raise: 'shoulder_press',
  barbell_row: 'barbell_row',
  bird_dog: 'bird_dog',
  side_plank: 'side_plank',
  anti_rotation: 'anti_rotation',
  hip_abduction: 'hip_abduction',
  calf_raise: 'calf_raise',
  farmer_carry: 'farmer_carry',
  bike_conditioning: 'low_impact_cardio',
  elliptical_conditioning: 'low_impact_cardio',
  chair_conditioning: 'low_impact_cardio',
  recovery_breath: 'recovery',
  band_press: 'band_press',
  leg_curl: 'leg_curl',
};

const entries = [...existing, ...planned].map((entry) => {
  const familySlug = FAMILY_REMAP[entry.familySlug];
  if (!familySlug) throw new Error(`Missing family remap for ${entry.familySlug}`);
  return { ...entry, familySlug };
});
if (entries.length !== 84) throw new Error(`Expected 84, got ${entries.length}`);

const families = new Set(entries.map((x) => x.familySlug));
if (families.size < 35 || families.size > 40) {
  throw new Error(`Family count ${families.size} out of 35-40: ${[...families].sort().join(', ')}`);
}

const header = `/**
 * WORKOUT-CATALOG-01A — target catalog manifest (exactly 84).
 * Machine-readable source of inventory / acceptance. Content bodies land in 01B.
 *
 * Generated helper may refresh this file; treat committed TS as SoT.
 */
import type {
  CatalogPlace,
  CatalogTrainingLevel,
  InitialCatalogStatus,
  LoadLevel,
  ManifestMovementPattern,
  PlannedContentPackage,
  RepetitionMode,
  WorkoutCatalogEquipment,
} from './catalog-enums';
import { CATALOG_MANIFEST_VERSION } from './catalog-enums';

export type CatalogManifestEntry = {
  ordinal: number;
  slug: string;
  familySlug: string;
  nameRu: string;
  nameEn: string;
  minLevel: CatalogTrainingLevel;
  supportedPlaces: CatalogPlace[];
  requiredEquipment: WorkoutCatalogEquipment[];
  optionalEquipment: WorkoutCatalogEquipment[];
  movementPattern: ManifestMovementPattern;
  primaryMuscleGroups: string[];
  secondaryMuscleGroups: string[];
  repetitionMode: RepetitionMode;
  impactLevel: LoadLevel;
  balanceRequirement: LoadLevel;
  floorRequired: boolean;
  overheadMovement: boolean;
  deepKneeFlexion: boolean;
  singleLeg: boolean;
  beginnerAllowed: boolean;
  initialCatalogStatus: InitialCatalogStatus;
  plannedContentPackage: PlannedContentPackage;
  /** Explicit legacy Exercise.key mapping; never fuzzy-matched. */
  legacyExerciseKey: string | null;
};

export const WORKOUT_CATALOG_MANIFEST_VERSION = CATALOG_MANIFEST_VERSION;

export const WORKOUT_CATALOG_MANIFEST = `;

const body = JSON.stringify(entries, null, 2)
  .replace(/"([^"]+)":/g, '$1:')
  .replace(/"/g, "'");

const footer = ` as const satisfies readonly CatalogManifestEntry[];

export type WorkoutCatalogManifest = typeof WORKOUT_CATALOG_MANIFEST;
`;

const out = resolve('apps/api/src/modules/workout-engine/catalog/catalog-manifest.ts');
writeFileSync(out, `${header}${body}${footer}\n`, 'utf8');
console.log(`Wrote ${entries.length} entries, ${families.size} families -> ${out}`);
console.log('EXISTING_APPROVED', entries.filter((x) => x.initialCatalogStatus === 'EXISTING_APPROVED').length);
console.log('PLANNED_FOR_01B', entries.filter((x) => x.initialCatalogStatus === 'PLANNED_FOR_01B').length);
