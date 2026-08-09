export type MediaSourceType =
  | 'OWNED_UPLOAD'
  | 'LICENSED_SOURCE'
  | 'PUBLIC_DOMAIN'
  | 'CREATIVE_COMMONS'
  | 'AI_GENERATED'
  | 'LEGACY_UNKNOWN';

export type MediaLicenseType =
  | 'ALL_RIGHTS_OWNED'
  | 'COMMERCIAL_LICENSE'
  | 'PUBLIC_DOMAIN'
  | 'CC0'
  | 'CC_BY'
  | 'CC_BY_SA'
  | 'EDITORIAL_ONLY'
  | 'UNKNOWN';

export type MediaRightsStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'EXPIRED'
  | 'RESTRICTED'
  | 'REJECTED'
  | 'TAKEDOWN';

export type MediaModerationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'BLOCKED';

export type RecipeMediaRole = 'HERO' | 'GALLERY' | 'STEP' | 'THUMBNAIL' | 'SOCIAL_PREVIEW';

export const ALLOWED_MEDIA_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** External sourceUrl is provenance only — never a USER runtime src. */
export const EXTERNAL_MEDIA_URL_POLICY = 'PROVENANCE_ONLY_NO_HOTLINK' as const;

export function requiresAttribution(licenseType: MediaLicenseType): boolean {
  return licenseType === 'CC_BY' || licenseType === 'CC_BY_SA' || licenseType === 'COMMERCIAL_LICENSE';
}

export function isPublicationEligibleMedia(input: {
  rightsStatus: MediaRightsStatus;
  moderationStatus: MediaModerationStatus;
  licenseType: MediaLicenseType;
  sourceType: MediaSourceType;
  attributionText?: string | null;
  rightsValidUntil?: Date | string | null;
  now?: Date;
}): { eligible: boolean; reason?: string } {
  if (input.sourceType === 'LEGACY_UNKNOWN') {
    return { eligible: false, reason: 'MEDIA_LEGACY_UNKNOWN' };
  }
  if (input.licenseType === 'UNKNOWN' || input.licenseType === 'EDITORIAL_ONLY') {
    return { eligible: false, reason: 'MEDIA_LICENSE_NOT_COMMERCIAL' };
  }
  if (input.rightsStatus !== 'APPROVED') {
    return { eligible: false, reason: `MEDIA_RIGHTS_${input.rightsStatus}` };
  }
  if (input.moderationStatus !== 'APPROVED') {
    return { eligible: false, reason: `MEDIA_MODERATION_${input.moderationStatus}` };
  }
  if (requiresAttribution(input.licenseType) && !String(input.attributionText ?? '').trim()) {
    return { eligible: false, reason: 'MEDIA_ATTRIBUTION_REQUIRED' };
  }
  if (input.rightsValidUntil) {
    const until = new Date(input.rightsValidUntil);
    const now = input.now ?? new Date();
    if (until.getTime() < now.getTime()) {
      return { eligible: false, reason: 'MEDIA_RIGHTS_EXPIRED' };
    }
  }
  return { eligible: true };
}

export function assertRightsTransition(from: MediaRightsStatus, to: MediaRightsStatus): void {
  const allowed: Record<MediaRightsStatus, MediaRightsStatus[]> = {
    PENDING_REVIEW: ['APPROVED', 'REJECTED', 'RESTRICTED', 'TAKEDOWN'],
    APPROVED: ['EXPIRED', 'RESTRICTED', 'TAKEDOWN', 'PENDING_REVIEW'],
    EXPIRED: ['PENDING_REVIEW', 'TAKEDOWN'],
    RESTRICTED: ['PENDING_REVIEW', 'TAKEDOWN', 'APPROVED'],
    REJECTED: ['PENDING_REVIEW', 'TAKEDOWN'],
    TAKEDOWN: [],
  };
  if (!(allowed[from] ?? []).includes(to)) {
    throw new Error('MEDIA_RIGHTS_TRANSITION_INVALID');
  }
}

export function toUserMediaDto(input: {
  id: string;
  role: string;
  altText: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  deliveryUrl: string | null;
  placeholder: boolean;
}) {
  return {
    id: input.id,
    role: input.role,
    altText: input.altText,
    caption: input.caption,
    width: input.width,
    height: input.height,
    mimeType: input.mimeType,
    url: input.placeholder ? null : input.deliveryUrl,
    placeholder: input.placeholder,
  };
}
