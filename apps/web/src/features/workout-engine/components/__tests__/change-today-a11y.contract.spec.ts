import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ChangeTodaySheet a11y contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/features/workout-engine/components/change-today-sheet.tsx'),
    'utf8',
  );

  it('implements focus trap cycle, Escape guard, and focus return', () => {
    expect(source).toContain('getDialogFocusableElements');
    expect(source).toContain("e.key === 'Escape'");
    expect(source).toContain("e.key !== 'Tab'");
    expect(source).toContain('e.shiftKey');
    expect(source).toContain('returnFocusRef');
    expect(source).toContain('previouslyFocused?.focus');
    expect(source).toContain('aria-modal');
    expect(source).toContain('aria-labelledby');
    expect(source).toContain("busyKey");
  });
});

describe('WorkoutEngineScreen soft-refresh contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/features/workout-engine/components/workout-engine-screen.tsx'),
    'utf8',
  );

  it('keeps softError path and soft retry without clearing ready UI', () => {
    expect(source).toContain("load({ soft: true })");
    expect(source).toContain('workout-soft-error');
    expect(source).toContain('workout-soft-retry');
    expect(source).toContain('setSoftError(human)');
    expect(source).toContain('if (soft)');
  });
});
