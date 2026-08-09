/**
 * WORKOUT-CATALOG-V3-01A — domain taxonomy validation (no DB).
 */
import { describe, expect, it } from 'vitest';
import {
  equipmentGroupsSatisfied,
  validateV3RevisionTaxonomyDraft,
} from '../catalog-v3-taxonomy.validation';
import { validateVariantGraph } from '../variant-graph.validation';

describe('CATALOG-V3-01A taxonomy domain validation', () => {
  it('accepts a decisive taxonomy draft with ALL_OF equipment', () => {
    const issues = validateV3RevisionTaxonomyDraft({
      exerciseRevisionId: 'rev-1',
      primaryMovementPattern: 'HORIZONTAL_PUSH',
      secondaryMovementPattern: 'CORE_ANTI_EXTENSION',
      trainingRole: 'MAIN',
      progressionGroup: 'push_up',
      muscles: [
        { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
        { muscleCode: 'TRICEPS', involvement: 'SECONDARY', sortOrder: 1 },
      ],
      equipmentGroups: [
        {
          groupKind: 'ALL_OF',
          sortOrder: 0,
          items: [
            { equipmentCode: 'DUMBBELL', sortOrder: 0 },
            { equipmentCode: 'BENCH', sortOrder: 1 },
          ],
        },
      ],
    });
    expect(issues).toEqual([]);
  });

  it('rejects duplicate muscle on same revision', () => {
    const issues = validateV3RevisionTaxonomyDraft({
      exerciseRevisionId: 'rev-1',
      muscles: [
        { muscleCode: 'CHEST', involvement: 'PRIMARY' },
        { muscleCode: 'CHEST', involvement: 'SECONDARY' },
      ],
    });
    expect(issues.some((i) => i.code === 'DUPLICATE_MUSCLE')).toBe(true);
  });

  it('rejects secondary-only muscle set (missing PRIMARY)', () => {
    const issues = validateV3RevisionTaxonomyDraft({
      exerciseRevisionId: 'rev-1',
      muscles: [{ muscleCode: 'TRICEPS', involvement: 'SECONDARY' }],
    });
    expect(issues.some((i) => i.code === 'MISSING_PRIMARY_MUSCLE')).toBe(true);
  });

  it('rejects empty ALL_OF equipment group', () => {
    const issues = validateV3RevisionTaxonomyDraft({
      exerciseRevisionId: 'rev-1',
      equipmentGroups: [{ groupKind: 'ALL_OF', items: [] }],
    });
    expect(issues.some((i) => i.code === 'EMPTY_EQUIPMENT_GROUP')).toBe(true);
  });

  it('rejects invalid trainingRole and does not invent MAIN default', () => {
    const empty = validateV3RevisionTaxonomyDraft({ exerciseRevisionId: 'rev-1' });
    expect(empty).toEqual([]);
    const bad = validateV3RevisionTaxonomyDraft({
      exerciseRevisionId: 'rev-1',
      trainingRole: 'FULL_BODY',
    });
    expect(bad.some((i) => i.code === 'INVALID_TRAINING_ROLE')).toBe(true);
  });

  it('evaluates ALL_OF and ANY_OF equipment semantics', () => {
    const groups = [
      { groupKind: 'ALL_OF', codes: ['DUMBBELL', 'BENCH'] },
      { groupKind: 'ANY_OF', codes: ['KETTLEBELL', 'DUMBBELL'] },
      { groupKind: 'OPTIONAL', codes: ['MAT'] },
    ];
    expect(
      equipmentGroupsSatisfied(groups, new Set(['DUMBBELL', 'BENCH', 'KETTLEBELL'])),
    ).toBe(true);
    expect(equipmentGroupsSatisfied(groups, new Set(['DUMBBELL']))).toBe(false);
    expect(equipmentGroupsSatisfied(groups, new Set(['DUMBBELL', 'BENCH']))).toBe(true);
  });

  it('rejects self progression edges in variant graph validation', () => {
    const issues = validateVariantGraph([
      {
        fromExerciseId: 'a',
        toExerciseId: 'a',
        relationType: 'EASIER',
        levelDelta: -1,
        active: true,
      },
    ]);
    expect(issues.some((i) => i.code === 'SELF_EDGE')).toBe(true);
  });

  it('rejects duplicate progression edges', () => {
    const edge = {
      fromExerciseId: 'a',
      toExerciseId: 'b',
      relationType: 'EASIER' as const,
      levelDelta: -1,
      active: true,
      equipmentContext: '',
      placeContext: '',
    };
    const issues = validateVariantGraph([edge, edge]);
    expect(issues.some((i) => i.code === 'DUP_EDGE')).toBe(true);
  });
});
