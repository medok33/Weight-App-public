import type {
  BetaBlockerItem,
  BetaTriageResult,
  ReleaseCandidateInput,
  ReleaseCandidateRecord,
} from './platform.types';

const ID = /^[a-z][a-z0-9._-]{1,63}$/;
const SEMVER = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/i;
const COMMIT = /^[0-9a-f]{7,40}$/i;

export function validateBetaBlockerItem(item: BetaBlockerItem): BetaBlockerItem {
  if (!ID.test(item.id?.trim() ?? '')) throw new Error('BETA_BLOCKER_INVALID');
  if (!item.title?.trim() || item.title.trim().length > 200) throw new Error('BETA_BLOCKER_INVALID');
  if (!['blocker', 'major', 'minor'].includes(item.severity)) throw new Error('BETA_BLOCKER_INVALID');
  if (typeof item.fixed !== 'boolean') throw new Error('BETA_BLOCKER_INVALID');
  return {
    id: item.id.trim(),
    title: item.title.trim(),
    severity: item.severity,
    fixed: item.fixed,
  };
}

/**
 * STEP_170: beta is release-ready only when every blocker is fixed.
 * Majors are reported but do not block readiness by themselves.
 */
export function triageBetaBlockers(items: BetaBlockerItem[]): BetaTriageResult {
  if (!Array.isArray(items) || items.length === 0) throw new Error('BETA_TRIAGE_EMPTY');
  const normalized = items.map(validateBetaBlockerItem);
  const openBlockers = normalized.filter((i) => i.severity === 'blocker' && !i.fixed).map((i) => i.id);
  const openMajors = normalized.filter((i) => i.severity === 'major' && !i.fixed).map((i) => i.id);
  return {
    ready: openBlockers.length === 0,
    openBlockers,
    openMajors,
    items: normalized,
  };
}

/** STEP_172: freeze release candidate + changelog (idempotent by version+commit). */
export function freezeReleaseCandidate(
  input: ReleaseCandidateInput,
  nowIso = new Date().toISOString(),
): ReleaseCandidateRecord {
  const version = input.version?.trim() ?? '';
  const changelog = input.changelog?.trim() ?? '';
  const commitSha = input.commitSha?.trim() ?? '';
  const frozenBy = input.frozenBy?.trim() ?? '';
  if (!SEMVER.test(version)) throw new Error('RC_VERSION_INVALID');
  if (changelog.length < 8 || changelog.length > 20_000) throw new Error('RC_CHANGELOG_INVALID');
  if (!COMMIT.test(commitSha)) throw new Error('RC_COMMIT_INVALID');
  if (!frozenBy) throw new Error('RC_ACTOR_INVALID');
  return {
    version,
    changelog,
    commitSha,
    frozenBy,
    status: 'frozen',
    frozenAt: nowIso,
  };
}
