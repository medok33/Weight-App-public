import { describe, expect, it } from 'vitest';
import { RevisionEngineController } from '../../src/modules/revision-engine/controllers/revision-engine.controller';
import type { RevisionEngineService } from '../../src/modules/revision-engine/application/revision-engine.service';

describe('revision-engine API controller', () => {
  it('preview and confirm call service with session user id', async () => {
    const calls: unknown[] = [];
    const service = {
      preview: async (...args: unknown[]) => {
        calls.push(['preview', ...args]);
        return {
          planId: 'p1',
          planKind: 'meal',
          currentVersion: 1,
          proposedVersion: 2,
          reason: 'travel',
          summary: 'ok',
          changedItems: [],
          warnings: [],
          validationStatus: 'ok',
          confirmationToken: 'token',
          proposedSnapshot: {},
        };
      },
      confirm: async (input: unknown) => {
        calls.push(['confirm', input]);
        return {
          revision: {
            id: 'r1',
            userId: 'u1',
            planId: 'p1',
            planKind: 'meal',
            version: 1,
            reason: 'travel',
            status: 'confirmed',
            snapshot: {},
            createdAt: new Date().toISOString(),
          },
          activePlanId: 'p2',
          activeVersion: 2,
          idempotentReplay: false,
        };
      },
    } as unknown as RevisionEngineService;

    const controller = new RevisionEngineController(service);
    const preview = await controller.preview({ id: 'u1' } as never, 'p1', { planKind: 'meal', reason: 'travel' });
    expect(preview.planId).toBe('p1');
    expect(calls[0]).toEqual(['preview', 'u1', 'p1', 'meal', 'travel']);

    const confirm = await controller.confirm(
      { id: 'u1' } as never,
      'p1',
      { planKind: 'meal', confirmationToken: 'token' },
      'idem-key-01',
    );
    expect(confirm.activeVersion).toBe(2);
    expect(calls[1]).toEqual([
      'confirm',
      {
        userId: 'u1',
        planId: 'p1',
        planKind: 'meal',
        confirmationToken: 'token',
        idempotencyKey: 'idem-key-01',
      },
    ]);
  });
});
