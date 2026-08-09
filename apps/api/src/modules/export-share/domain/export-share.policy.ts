import type { ExportJobDraft, ExportJobStatus, ExportJobType } from './export-share.types';

export const EXPORT_TRANSITIONS: Readonly<Record<ExportJobStatus, readonly ExportJobStatus[]>> = {
  queued: ['queued', 'running', 'cancelled'],
  running: ['running', 'succeeded', 'failed'],
  succeeded: ['succeeded'],
  failed: ['failed'],
  cancelled: ['cancelled'],
};

const TYPES = new Set<ExportJobType>(['meal_plan_pdf', 'shopping_list_print']);

export function validateExportJobDraft(input: ExportJobDraft): ExportJobDraft {
  if (!input.userId) throw new Error('EXPORT_JOB_INVALID');
  if (!TYPES.has(input.type)) throw new Error('EXPORT_JOB_INVALID');
  if (input.status !== 'queued') throw new Error('EXPORT_JOB_INVALID');
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(input.idempotencyKey)) throw new Error('EXPORT_JOB_INVALID');
  return { ...input, payload: input.payload ?? {} };
}

export function transitionExportJob(current: ExportJobStatus, next: ExportJobStatus): ExportJobStatus {
  if (!EXPORT_TRANSITIONS[current]?.includes(next)) throw new Error('EXPORT_INVALID_TRANSITION');
  return next;
}
