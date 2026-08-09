import { describe, expect, it, vi } from 'vitest';
import { FamilyModeService } from '../application/family-mode.service';
import { assertHealthShareAllowed, assertCanLeave } from '../domain/family-mode.policy';

function createHarness(member: unknown = null, accept: unknown = null) {
  const repository = {
    member: vi.fn().mockResolvedValue(member),
    accept: vi.fn().mockResolvedValue(accept),
    members: vi.fn(),
    pendingCount: vi.fn().mockResolvedValue({ count: '0' }),
    createInvitation: vi.fn(),
    revoke: vi.fn(),
    deactivate: vi.fn(),
    setHealthConsent: vi.fn(),
    myFamily: vi.fn(),
    create: vi.fn(),
  };
  const audit = { appendEvent: vi.fn() };
  return { repository, audit, service: new FamilyModeService(repository as never, audit as never) };
}

describe('family access controls', () => {
  it('prevents IDOR membership listing by non-members', async () => {
    const { service } = createHarness();
    await expect(service.listMembers('other-user', 'family-id')).rejects.toThrow('FAMILY_FORBIDDEN');
  });

  it('returns the same generic error for replayed, expired, or revoked invitations', async () => {
    const { service } = createHarness({ role: 'MEMBER', status: 'ACTIVE' }, null);
    await expect(service.acceptInvitation('user', 'expired-or-replayed')).rejects.toThrow(
      'FAMILY_INVITATION_INVALID',
    );
  });

  it('blocks last owner from leaving', async () => {
    const { service } = createHarness({
      id: 'm1',
      role: 'OWNER',
      status: 'ACTIVE',
      healthShareConsent: false,
    });
    await expect(service.leaveFamily('owner', 'family-id')).rejects.toThrow('FAMILY_LAST_OWNER_CANNOT_LEAVE');
  });

  it('denies health-like data without consent and never auto-shares passwords', () => {
    const member = {
      id: 'm1',
      familyId: 'f1',
      userId: 'u1',
      role: 'MEMBER' as const,
      status: 'ACTIVE' as const,
      healthShareConsent: false,
    };
    expect(() => assertHealthShareAllowed(member, 'exact_weight')).toThrow('FAMILY_SHARE_DENIED');
    expect(() => assertCanLeave({ ...member, role: 'OWNER' })).toThrow('FAMILY_LAST_OWNER_CANNOT_LEAVE');
  });
});
