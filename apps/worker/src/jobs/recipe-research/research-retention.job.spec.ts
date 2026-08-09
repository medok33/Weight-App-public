import { describe, expect, it } from 'vitest';
import { assertResearchWorkerNetworkCalls, runResearchRetentionTick } from './research-retention.job';

describe('RP2-04B research retention worker job', () => {
  it('reports zero network calls by contract', () => {
    expect(assertResearchWorkerNetworkCalls()).toBe(0);
  });

  it('applies retention SQL and is idempotent on empty set', async () => {
    const calls: string[] = [];
    const client = {
      async query(sql: string) {
        calls.push(sql);
        return { rows: [] };
      },
    };
    const first = await runResearchRetentionTick(client as never);
    const second = await runResearchRetentionTick(client as never);
    expect(first).toEqual({ action: 'NO_OP', redacted: 0, staleRuns: 0 });
    expect(second).toEqual({ action: 'NO_OP', redacted: 0, staleRuns: 0 });
    expect(calls.length).toBe(4);
    expect(calls.some((s) => s.includes('RecipeSourceRawSnapshot'))).toBe(true);
    expect(calls.some((s) => s.includes('RecipeResearchRun'))).toBe(true);
  });
});
