import { describe, expect, it } from 'vitest';
import {
  assertNonMedicalLanguage,
  buildAdaptationPreview,
  buildGoalImpact,
  listMoveDayTargets,
  type AdaptationPolicyInput,
  type VariantEdge,
} from '../domain/workout-adaptation.policy';
import type { CatalogExercise } from '../domain/workout-engine.types';

function exercise(key: string, equipmentCodes: string[] = ['BODYWEIGHT']): CatalogExercise {
  return {
    id: `exercise-${key}`,
    key,
    name: key,
    displayNameRu: key,
    displayNameEn: key,
    riskLevel: 'low',
    movementPattern: 'SQUAT',
    difficulty: 'BEGINNER',
    equipmentCodes,
    isActive: true,
    exerciseRevisionId: `revision-${key}`,
  };
}

const catalog = [
  exercise('barbell_squat', ['BARBELL']),
  exercise('goblet_squat', ['KETTLEBELL']),
  exercise('bodyweight_squat'),
  exercise('z_assisted_squat'),
  exercise('harder_squat'),
  exercise('morning_walk'),
  exercise('recovery_walk'),
  exercise('stretching'),
];

const edges: VariantEdge[] = [
  { fromKey: 'barbell_squat', toKey: 'harder_squat', relationType: 'HARDER', priority: 0, levelDelta: 1 },
  { fromKey: 'barbell_squat', toKey: 'goblet_squat', relationType: 'EASIER', priority: 0, levelDelta: -1 },
  { fromKey: 'barbell_squat', toKey: 'bodyweight_squat', relationType: 'EASIER', priority: 0, levelDelta: -1 },
  { fromKey: 'barbell_squat', toKey: 'z_assisted_squat', relationType: 'EASIER', priority: 0, levelDelta: -1 },
];

function input(intent: AdaptationPolicyInput['intent'], patch: Partial<AdaptationPolicyInput> = {}): AdaptationPolicyInput {
  return {
    intent,
    catalog,
    edges,
    profile: {
      trainingLevel: 'BEGINNER',
      workoutEquipment: ['BODYWEIGHT'],
      excludedExerciseKeys: [],
    },
    session: {
      id: 'session-1',
      workoutPlanId: 'plan-1',
      sourceDayIndex: 0,
      effectiveDayIndex: 0,
      effectiveDate: '2026-08-03',
      dayTitle: 'Сила',
      estimatedMinutes: 30,
      version: 1,
      catalogReleaseId: 'release-1',
      exercises: [
        {
          orderIndex: 0,
          exerciseKey: 'barbell_squat',
          sourceExerciseId: 'exercise-barbell_squat',
          exerciseRevisionId: 'revision-barbell_squat',
          catalogReleaseId: 'release-1',
          displayNameRu: 'Присед',
          displayNameEn: 'Squat',
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
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
    },
    ...patch,
  };
}

describe('WORKOUT-V2-01D adaptation policy', () => {
  it('HOME ranks priority-zero easier/same alternatives and never recommends HARDER', () => {
    const preview = buildAdaptationPreview(input('HOME'));
    expect(preview.recommended?.optionCode).toBe('HOME_SAFE_MIN_EQUIP');
    expect(preview.recommended?.preview.exercises[0]?.exerciseKey).toBe('bodyweight_squat');
    expect(preview.recommended?.preview.exercises.map((item) => item.exerciseKey)).not.toContain('harder_squat');
  });

  it('HOME filters unavailable equipment and excluded exercises', () => {
    const preview = buildAdaptationPreview(input('HOME', {
      profile: {
        trainingLevel: 'BEGINNER',
        workoutEquipment: ['BODYWEIGHT'],
        excludedExerciseKeys: ['bodyweight_squat'],
      },
    }));
    expect(preview.recommended?.preview.exercises[0]?.exerciseKey).toBe('z_assisted_squat');
    expect(preview.recommended?.preview.exercises[0]?.exerciseKey).not.toBe('goblet_squat');
  });

  it('SHORTER retains a main block and never returns empty training', () => {
    const preview = buildAdaptationPreview(input('SHORTER'));
    for (const option of [preview.recommended, ...preview.alternatives]) {
      expect(option?.preview.exercises.length).toBeGreaterThan(0);
      expect(option?.preview.exercises.some((item) => item.exerciseKey === 'barbell_squat')).toBe(true);
    }
  });

  it('LIGHTER uses EASIER relation candidates', () => {
    const preview = buildAdaptationPreview(input('LIGHTER', {
      profile: {
        trainingLevel: 'BEGINNER',
        workoutEquipment: ['KETTLEBELL'],
        excludedExerciseKeys: [],
      },
    }));
    const chosen = preview.recommended?.preview.exercises[0]?.exerciseKey;
    expect(edges.some((edge) => edge.toKey === chosen && edge.relationType === 'EASIER')).toBe(true);
  });

  it('WALK_RECOVERY has recovery-priority goal impact and disclaimer', () => {
    const preview = buildAdaptationPreview(input('WALK_RECOVERY'));
    expect(preview.recommended?.goalImpact.impactCategory).toBe('RECOVERY_PRIORITY');
    expect(preview.recommended?.goalImpact.disclaimerRu).toMatch(/приблизительная/i);
  });

  it('MOVE_DAY excludes occupied and heavy-adjacent target days', () => {
    expect(listMoveDayTargets(0, [
      { dayIndex: 0, isRestDay: false, exerciseKeys: ['barbell_squat'] },
      { dayIndex: 1, isRestDay: true, exerciseKeys: [] },
      { dayIndex: 2, isRestDay: false, exerciseKeys: ['push_up'] },
      { dayIndex: 3, isRestDay: true, exerciseKeys: [] },
      { dayIndex: 4, isRestDay: true, exerciseKeys: [] },
    ], [], 0)).toEqual([4, 5, 6]);
  });

  it('maps all goal impact categories to stable non-medical messages', () => {
    for (const category of ['GOAL_PRESERVED', 'MOSTLY_PRESERVED', 'RECOVERY_PRIORITY', 'SCHEDULE_ONLY', 'NOTICEABLE_REDUCTION'] as const) {
      const impact = buildGoalImpact('SHORTER', category);
      expect(impact.impactCategory).toBe(category);
      expect(impact.summaryRu).toBeTruthy();
      assertNonMedicalLanguage(impact);
    }
  });

  it('is deterministic for same input', () => {
    const first = buildAdaptationPreview(input('HOME'));
    const second = buildAdaptationPreview(input('HOME'));
    expect([first.recommended, ...first.alternatives].map((item) => item?.optionCode))
      .toEqual([second.recommended, ...second.alternatives].map((item) => item?.optionCode));
  });

  it('rejects exact physiological promises', () => {
    expect(() => assertNonMedicalLanguage({
      ...buildGoalImpact('HOME', 'GOAL_PRESERVED'),
      summaryRu: 'Точно сожжёте жир.',
    })).toThrow('WORKOUT_ADAPTATION_LANGUAGE_INVALID');
  });
});
