export type FamilyRole = 'OWNER' | 'MEMBER';
export type FamilyMemberStatus = 'ACTIVE' | 'LEFT' | 'REMOVED';
export type FamilyInvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export type FamilyRecord = {
  id: string;
  ownerUserId: string;
  name: string;
};

export type FamilyMemberRecord = {
  id: string;
  familyId: string;
  userId: string;
  role: FamilyRole;
  status: FamilyMemberStatus;
  healthShareConsent: boolean;
};

/** Data classes that are never auto-shared with family members. */
export const FAMILY_NEVER_SHARED = [
  'password',
  'sessions',
  'ai_chat',
  'payments',
  'medical_restrictions',
  'exact_weight',
  'private_exports',
] as const;
