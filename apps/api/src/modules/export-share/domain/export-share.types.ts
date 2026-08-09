export type ExportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ExportJobType = 'meal_plan_pdf' | 'shopping_list_print';

export type ExportJobDraft = {
  userId: string;
  type: ExportJobType;
  status: ExportJobStatus;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export type ExportJobRecord = ExportJobDraft & {
  id: string;
  result: Record<string, unknown> | null;
  errorCode: string | null;
};
