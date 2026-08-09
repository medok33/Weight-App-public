import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('revision-engine UI contract', () => {
  it('embeds revise CTA and preview/confirm controls', () => {
    const panel = readFileSync(
      resolve(process.cwd(), 'src/features/revision-engine/components/plan-revision-panel.tsx'),
      'utf8',
    );
    expect(panel).toContain('revision-open');
    expect(panel).toContain('revision-preview');
    expect(panel).toContain('revision-confirm');
    expect(panel).toContain('revision-cancel');
  });

  it('wires panel into meal; workout hub omits revision chrome (01E)', () => {
    const meal = readFileSync(resolve(process.cwd(), 'src/features/meal-plan/components/meal-plan-screen.tsx'), 'utf8');
    const workout = readFileSync(
      resolve(process.cwd(), 'src/features/workout-engine/components/workout-engine-screen.tsx'),
      'utf8',
    );
    expect(meal).toContain('PlanRevisionPanel');
    // WORKOUT-V2-01E: USER Week/Today must not show Version/revision admin chrome.
    expect(workout).not.toContain('PlanRevisionPanel');
    expect(workout).not.toContain('workout-plan-version');
  });
});
