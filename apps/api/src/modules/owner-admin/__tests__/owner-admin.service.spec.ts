import { describe, expect, it } from 'vitest';
import { OwnerAdminService } from '../application/owner-admin.service';

describe('OwnerAdminService unified session', () => {
  it('grants access and audits via unified session user', async () => {
    const calls: unknown[] = [];
    const service = new OwnerAdminService(
      {
        recordAudit: async (...args: unknown[]) => {
          calls.push(args);
        },
      } as never,
      { writeAuditLog: async () => undefined } as never,
    );
    await expect(
      service.access({ id: 'u1', email: null, username: 'owner', role: 'OWNER' }),
    ).resolves.toEqual({ allowed: true, role: 'OWNER' });
    expect(calls).toHaveLength(1);
  });

  it('secrets status never returns raw secret values', () => {
    const service = new OwnerAdminService({} as never, {} as never);
    const status = service.secretsStatus({ id: 'u1', email: null, username: 'owner', role: 'OWNER' });
    expect(status.AUTH_SESSION_SECRET === 'configured' || status.AUTH_SESSION_SECRET === 'not configured').toBe(true);
    expect(JSON.stringify(status)).not.toContain('sk-');
  });
});
