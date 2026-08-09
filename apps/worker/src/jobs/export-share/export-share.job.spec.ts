import { describe, expect, it } from 'vitest';
import { createExportShareJob } from './export-share.job';
import { processExportShareJob } from './export-share.processor';

describe('export-share job', () => {
  it('accepts queued export for API processing', () => {
    const job = createExportShareJob('j1', 'u1', 'meal_plan_pdf', 'export-key-01');
    expect(processExportShareJob(job).next).toBe('api.export-share.processJob');
  });

  it('rejects invalid payload', () => {
    expect(() => createExportShareJob('', 'u1', 'meal_plan_pdf', 'export-key-01')).toThrow(
      'EXPORT_SHARE_JOB_INVALID',
    );
  });
});
