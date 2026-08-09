import { describe, expect, it } from 'vitest';
import { OwnerAdminService } from '../application/owner-admin.service';

describe('owner overview', () => {
  it('returns persisted metrics after access gate', async () => {
    const service = new OwnerAdminService(
      {
        recordAudit: async () => undefined,
        overviewMetrics: async () => ({ users: 4, activeSessions: 2, auditEvents: 8 }),
      } as never,
      { writeAuditLog: async () => undefined } as never,
    );
    await expect(
      service.overview({ id: 'u1', email: null, username: 'owner', role: 'OWNER' }),
    ).resolves.toEqual({
      allowed: true,
      role: 'OWNER',
      metrics: { users: 4, activeSessions: 2, auditEvents: 8 },
    });
  });
});