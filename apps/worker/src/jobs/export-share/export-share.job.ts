export type ExportShareJob = {
  jobId: string;
  userId: string;
  type: 'meal_plan_pdf' | 'shopping_list_print';
  idempotencyKey: string;
};

export function createExportShareJob(
  jobId: string,
  userId: string,
  type: ExportShareJob['type'],
  idempotencyKey: string,
): ExportShareJob {
  if (!jobId || !userId || !idempotencyKey) throw new Error('EXPORT_SHARE_JOB_INVALID');
  if (type !== 'meal_plan_pdf' && type !== 'shopping_list_print') throw new Error('EXPORT_SHARE_JOB_INVALID');
  return { jobId, userId, type, idempotencyKey };
}
