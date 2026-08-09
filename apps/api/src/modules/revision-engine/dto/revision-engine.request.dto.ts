export type PreviewRevisionRequest = {
  planKind: 'meal' | 'workout';
  reason: string;
};

export type ConfirmRevisionRequest = {
  planKind: 'meal' | 'workout';
  confirmationToken: string;
};

export function parsePreviewBody(body: unknown): PreviewRevisionRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('REVISION_INVALID');
  const record = body as Record<string, unknown>;
  const allowed = new Set(['planKind', 'reason']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error('REVISION_UNKNOWN_FIELD');
  }
  if (record.planKind !== 'meal' && record.planKind !== 'workout') throw new Error('REVISION_PLAN_KIND_INVALID');
  if (typeof record.reason !== 'string') throw new Error('REVISION_REASON_REQUIRED');
  return { planKind: record.planKind, reason: record.reason };
}

export function parseConfirmBody(body: unknown): ConfirmRevisionRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('REVISION_INVALID');
  const record = body as Record<string, unknown>;
  const allowed = new Set(['planKind', 'confirmationToken']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error('REVISION_UNKNOWN_FIELD');
  }
  if (record.planKind !== 'meal' && record.planKind !== 'workout') throw new Error('REVISION_PLAN_KIND_INVALID');
  if (typeof record.confirmationToken !== 'string' || !record.confirmationToken) throw new Error('REVISION_TOKEN_INVALID');
  return { planKind: record.planKind, confirmationToken: record.confirmationToken };
}
