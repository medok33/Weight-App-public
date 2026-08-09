import type {
  ConsentKind,
  LegalDocumentKind,
  LegalDocumentVersion,
  LegalVersionCheckResult,
} from './legal-consent.types';

export const REQUIRED_CONSENTS: readonly ConsentKind[] = ['terms', 'privacy'];
export const OPTIONAL_CONSENTS: readonly ConsentKind[] = ['health_tracking', 'communications', 'ai_assistant'];

/** Canonical published legal docs for beta release gate (STEP_166). */
export const REQUIRED_LEGAL_DOCUMENTS: readonly LegalDocumentVersion[] = [
  {
    kind: 'terms',
    version: '1.0.0',
    checksum: 'terms-1.0.0',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
  {
    kind: 'privacy',
    version: '1.0.0',
    checksum: 'privacy-1.0.0',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
  {
    kind: 'health_consent',
    version: '1.0.0',
    checksum: 'health-1.0.0',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
];

const VERSION = /^\d+\.\d+\.\d+$/;

export function validateLegalDocumentVersion(doc: LegalDocumentVersion): LegalDocumentVersion {
  if (!['terms', 'privacy', 'health_consent'].includes(doc.kind)) throw new Error('LEGAL_DOC_INVALID');
  if (!VERSION.test(doc.version)) throw new Error('LEGAL_DOC_INVALID');
  if (!doc.checksum?.trim()) throw new Error('LEGAL_DOC_INVALID');
  if (!doc.effectiveAt || Number.isNaN(Date.parse(doc.effectiveAt))) throw new Error('LEGAL_DOC_INVALID');
  return { ...doc, checksum: doc.checksum.trim() };
}

/**
 * STEP_166: compare published catalog against required kinds/versions.
 * Missing kinds or lower semver than required → not ok.
 */
export function checkLegalContentVersions(
  published: LegalDocumentVersion[],
  required: readonly LegalDocumentVersion[] = REQUIRED_LEGAL_DOCUMENTS,
): LegalVersionCheckResult {
  const current = published.map(validateLegalDocumentVersion);
  const byKind = new Map(current.map((d) => [d.kind, d]));
  const missing: LegalDocumentKind[] = [];
  const outdated: LegalDocumentKind[] = [];
  for (const req of required) {
    const found = byKind.get(req.kind);
    if (!found) {
      missing.push(req.kind);
      continue;
    }
    if (compareSemver(found.version, req.version) < 0) outdated.push(req.kind);
  }
  return { ok: missing.length === 0 && outdated.length === 0, missing, outdated, current };
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
