import { describe, expect, it } from 'vitest';
import { runPipeline } from '../../../../scripts/recipe-corpus-synthesis-readiness-01';

describe('CONTENT-01-07C3 canonical donor corpus contract', () => {
  it('retains only one donor recipe for Tomato and Rice targets', () => {
    const result = runPipeline();
    const tomato = result.briefs.find((brief) => brief.deterministicSelections?.some((line) => line.sourceCandidateId === 'eda:nezhnij-omlet-s-pomidorami-46770'));
    const rice = result.briefs.find((brief) => brief.deterministicSelections?.some((line) => line.sourceCandidateId === 'eda:risovaya-kasha-126246'));
    expect(tomato).toBeDefined();
    expect(rice).toBeDefined();
    expect(tomato?.deterministicSelections?.map((line) => line.sourceCandidateId)).toEqual([
      'eda:nezhnij-omlet-s-pomidorami-46770',
      'eda:nezhnij-omlet-s-pomidorami-46770',
      'eda:nezhnij-omlet-s-pomidorami-46770',
    ]);
    expect(tomato?.deterministicSelections?.map((line) => line.sourceIngredientOrdinal)).toEqual([1, 2, 4]);
    expect(tomato?.deterministicSelections?.every((line) => line.sourceCandidateId.startsWith('eda:'))).toBe(true);
    expect(rice?.deterministicSelections?.every((line) => line.sourceCandidateId === 'eda:risovaya-kasha-126246')).toBe(true);
    expect(rice?.deterministicSelections?.map((line) => line.sourceIngredientOrdinal)).toEqual([1, 3, 4, 5]);
    expect(new Set(tomato?.deterministicSelections?.map((line) => line.sourceCandidateId)).size).toBe(1);
    expect(new Set(rice?.deterministicSelections?.map((line) => line.sourceCandidateId)).size).toBe(1);
  }, 20_000);
});
