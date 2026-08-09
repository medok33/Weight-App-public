export type AuditEventDraft = {
  actorUserId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

export type AuditEventRecord = AuditEventDraft & {
  id: string;
  createdAt: string;
};

const ACTION = /^[a-z][a-z0-9._-]{2,96}$/;

export function validateAuditEventDraft(input: AuditEventDraft): AuditEventDraft {
  if (!ACTION.test(input.action)) throw new Error('AUDIT_EVENT_INVALID');
  return {
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    requestId: input.requestId ?? null,
    metadata: input.metadata ?? {},
  };
}
