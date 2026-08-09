/**
 * Executable product-policy validation (fail-closed).
 * Policy flags that look like enforcement must actually be enforced.
 */
import type { ContentValidationIssue } from './content.types';
import { WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY } from './product-policy';

const ALLOWED_SESSION_TOTAL_POLICIES = ['NO_SESSION_TOTAL_UNTIL_FULL_COVERAGE'] as const;
const ALLOWED_REPS_TIMING_POLICIES = ['MOVEMENT_SPECIFIC_REVIEWED_ONLY'] as const;
const ALLOWED_COVERAGE_REQUIREMENTS = ['FULL_GENERATOR_VISIBLE'] as const;

/** Loose shape so mutation probes can inject forbidden flags without TS evasion games. */
export type ContentPolicyProbe = {
  policyVersion: string;
  universalTimingAllowed: boolean;
  familyFallbackAllowed: boolean;
  nameFallbackAllowed: boolean;
  estimatedDurationFallbackAllowed: boolean;
  partialCoverageAllowed: boolean;
  requiredCoveragePercent: number;
  coverageRequirement: string;
  wallAngelsTargetMode: string;
  wallAngelsExerciseKey: string;
  sessionTotalPolicy: string;
  repsTimingPolicy: string;
  catalogReleaseKey: string;
};

function policyIssue(code: string, message: string): ContentValidationIssue {
  return {
    level: 'error',
    surface: 'policy',
    code,
    exerciseKey: '*',
    message,
  };
}

/**
 * Fail closed when executable policy unexpectedly allows soft coverage / fallbacks.
 * Runs before coverage analysis in repository and strict modes.
 */
export function validateContentPolicy(
  policy: ContentPolicyProbe = WORKOUT_ENERGY_CONTENT_PRODUCT_POLICY,
): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];

  if (policy.universalTimingAllowed !== false) {
    issues.push(
      policyIssue(
        'POLICY_UNIVERSAL_TIMING_ALLOWED',
        'universalTimingAllowed must be false',
      ),
    );
  }
  if (policy.familyFallbackAllowed !== false) {
    issues.push(
      policyIssue('POLICY_FAMILY_FALLBACK_ALLOWED', 'familyFallbackAllowed must be false'),
    );
  }
  if (policy.nameFallbackAllowed !== false) {
    issues.push(policyIssue('POLICY_NAME_FALLBACK_ALLOWED', 'nameFallbackAllowed must be false'));
  }
  if (policy.estimatedDurationFallbackAllowed !== false) {
    issues.push(
      policyIssue(
        'POLICY_ESTIMATED_DURATION_FALLBACK_ALLOWED',
        'estimatedDurationFallbackAllowed must be false',
      ),
    );
  }
  if (policy.partialCoverageAllowed !== false) {
    issues.push(
      policyIssue('POLICY_PARTIAL_COVERAGE_ALLOWED', 'partialCoverageAllowed must be false'),
    );
  }
  if (policy.requiredCoveragePercent !== 100) {
    issues.push(
      policyIssue(
        'POLICY_REQUIRED_COVERAGE_PERCENT',
        'requiredCoveragePercent must be exactly 100',
      ),
    );
  }
  if (
    !(ALLOWED_COVERAGE_REQUIREMENTS as readonly string[]).includes(policy.coverageRequirement)
  ) {
    issues.push(
      policyIssue(
        'POLICY_COVERAGE_REQUIREMENT',
        'coverageRequirement must be FULL_GENERATOR_VISIBLE',
      ),
    );
  }
  if (policy.wallAngelsTargetMode !== 'REPS') {
    issues.push(
      policyIssue('POLICY_WALL_ANGELS_TARGET_MODE', 'wallAngelsTargetMode must be REPS'),
    );
  }
  if (!(ALLOWED_SESSION_TOTAL_POLICIES as readonly string[]).includes(policy.sessionTotalPolicy)) {
    issues.push(
      policyIssue(
        'POLICY_SESSION_TOTAL_UNKNOWN',
        `unknown sessionTotalPolicy: ${String(policy.sessionTotalPolicy)}`,
      ),
    );
  }
  if (!(ALLOWED_REPS_TIMING_POLICIES as readonly string[]).includes(policy.repsTimingPolicy)) {
    issues.push(
      policyIssue(
        'POLICY_REPS_TIMING_UNKNOWN',
        `unknown repsTimingPolicy: ${String(policy.repsTimingPolicy)}`,
      ),
    );
  }
  if (policy.catalogReleaseKey !== 'workout-catalog-canonical-01b') {
    issues.push(
      policyIssue(
        'POLICY_CATALOG_RELEASE_KEY',
        'catalogReleaseKey must be workout-catalog-canonical-01b',
      ),
    );
  }

  return issues;
}
