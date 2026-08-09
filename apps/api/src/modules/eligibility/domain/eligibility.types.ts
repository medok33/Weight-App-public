export type EligibilityAnswers = {
  ageBand: 'under_18' | '18_64' | '65_plus' | 'unknown';
  pregnancy: boolean;
  eatingDisorderRisk: boolean;
  clinicianClearance?: boolean;
};

export type EligibilityOutcome = 'eligible' | 'blocked' | 'needs_review';

export type EligibilityDecision = {
  outcome: EligibilityOutcome;
  reasonCode?: 'MINOR' | 'PREGNANCY' | 'EATING_DISORDER_RISK' | 'MISSING_CLEARANCE';
  policyVersion: string;
};
