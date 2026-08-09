import { describe, expect, it } from 'vitest';
import { localizeContentKeys } from '../components/assistant-rich-text';

describe('assistant content localization', () => {
  it('replaces meal and workout keys with labels', () => {
    const tc = (ns: string, key: string) => {
      if (ns === 'meal' && key === 'protein_power_bowl') return 'Белковая тарелка';
      if (ns === 'workout' && key === 'morning_walk') return 'Утренняя прогулка';
      return key;
    };
    const raw = 'Сегодня: protein_power_bowl и morning_walk (560 kcal).';
    const out = localizeContentKeys(raw, tc as never);
    expect(out).toContain('Белковая тарелка');
    expect(out).toContain('Утренняя прогулка');
    expect(out).not.toContain('protein_power_bowl');
    expect(out).not.toContain('morning_walk');
  });
});
