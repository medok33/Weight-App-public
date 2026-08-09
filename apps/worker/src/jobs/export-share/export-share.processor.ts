import type { ExportShareJob } from './export-share.job';

/**
 * Worker job contract for export-share.
 * Actual PDF/HTML rendering + storage runs in API ExportShareService (same ExportJob row).
 * Processor records the intended outcome shape for queue runners.
 */
export function processExportShareJob(job: ExportShareJob) {
  return {
    jobId: job.jobId,
    userId: job.userId,
    type: job.type,
    idempotencyKey: job.idempotencyKey,
    status: 'accepted' as const,
    next: 'api.export-share.processJob',
  };
}
