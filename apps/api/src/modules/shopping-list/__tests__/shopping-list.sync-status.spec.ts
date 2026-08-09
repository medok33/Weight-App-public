import { describe, expect, it } from 'vitest';
import { resolveSyncStatus } from '../application/shopping-list.service';

describe('resolveSyncStatus', () => {
  it('maps generation and plan version to sync status', () => {
    expect(resolveSyncStatus({ sourcePlanVersion: 2, generationStatus: 'CURRENT' }, 2)).toBe('current');
    expect(resolveSyncStatus({ sourcePlanVersion: 1, generationStatus: 'CURRENT' }, 2)).toBe('stale');
    expect(resolveSyncStatus({ sourcePlanVersion: 2, generationStatus: 'STALE' }, 2)).toBe('stale');
    expect(resolveSyncStatus({ sourcePlanVersion: 2, generationStatus: 'REBUILDING' }, 2)).toBe('rebuilding');
    expect(resolveSyncStatus({ sourcePlanVersion: 2, generationStatus: 'FAILED' }, 2)).toBe('failed');
    expect(resolveSyncStatus({ sourcePlanVersion: null, generationStatus: 'CURRENT' }, 1)).toBe('unknown');
  });
});
