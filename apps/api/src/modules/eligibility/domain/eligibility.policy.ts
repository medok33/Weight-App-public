import type { EligibilityAnswers, EligibilityDecision } from './eligibility.types';

export const ELIGIBILITY_POLICY_VERSION = 'eligibility-1.0';

export function decideEligibility(answers: EligibilityAnswers): EligibilityDecision {
  if (answers.ageBand === 'under_18' || answers.ageBand === 'unknown') return { outcome: 'blocked', reasonCode: 'MINOR', policyVersion: ELIGIBILITY_POLICY_VERSION };
  if (answers.pregnancy) return { outcome: 'needs_review', reasonCode: 'PREGNANCY', policyVersion: ELIGIBILITY_POLICY_VERSION };
  if (answers.eatingDisorderRisk) return { outcome: 'needs_review', reasonCode: 'EATING_DISORDER_RISK', policyVersion: ELIGIBILITY_POLICY_VERSION };
  if (answers.ageBand === '65_plus' && answers.clinicianClearance !== true) return { outcome: 'needs_review', reasonCode: 'MISSING_CLEARANCE', policyVersion: ELIGIBILITY_POLICY_VERSION };
  return { outcome: 'eligible', policyVersion: ELIGIBILITY_POLICY_VERSION };
}

export function validateEligibilityAnswers(input: Partial<EligibilityAnswers>): EligibilityAnswers {
  if (!input.ageBand || typeof input.pregnancy !== 'boolean' || typeof input.eatingDisorderRisk !== 'boolean') throw new Error('ELIGIBILITY_INVALID_INPUT');
  return input as EligibilityAnswers;
}
