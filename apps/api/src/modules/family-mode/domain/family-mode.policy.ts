import type { FamilyMemberRecord, FamilyRole } from './family-mode.types';
import { FAMILY_NEVER_SHARED } from './family-mode.types';

export function validateFamilyName(name: string): string {
  const trimmed = name?.trim() ?? '';
  if (trimmed.length < 1 || trimmed.length > 120) throw new Error('FAMILY_INVALID');
  return trimmed;
}

export function assertActiveMember(member: FamilyMemberRecord | null | undefined): FamilyMemberRecord {
  if (!member || member.status !== 'ACTIVE') throw new Error('FAMILY_FORBIDDEN');
  return member;
}

export function assertOwnerRole(member: FamilyMemberRecord): FamilyMemberRecord {
  if (member.role !== 'OWNER') throw new Error('FAMILY_FORBIDDEN');
  return member;
}

export function assertCanLeave(member: FamilyMemberRecord): void {
  if (member.role === 'OWNER') throw new Error('FAMILY_LAST_OWNER_CANNOT_LEAVE');
}

export function assertPendingInviteCapacity(pendingCount: number, max = 10): void {
  if (pendingCount >= max) throw new Error('FAMILY_INVITATION_RATE_LIMITED');
}

/** Health-like payloads require explicit consent; never auto-share sensitive classes. */
export function assertHealthShareAllowed(member: FamilyMemberRecord, dataClass: string): void {
  if ((FAMILY_NEVER_SHARED as readonly string[]).includes(dataClass)) {
    throw new Error('FAMILY_SHARE_DENIED');
  }
  if (!member.healthShareConsent) throw new Error('FAMILY_HEALTH_SHARE_DENIED');
}

export function invitationGenericError(): Error {
  return new Error('FAMILY_INVITATION_INVALID');
}

export function isOwner(role: FamilyRole): boolean {
  return role === 'OWNER';
}
