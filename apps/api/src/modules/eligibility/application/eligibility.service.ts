import { decideEligibility, validateEligibilityAnswers } from '../domain/eligibility.policy';
import type { EligibilityAnswers } from '../domain/eligibility.types';
import { EligibilityRepository } from '../infrastructure/eligibility.repository';

export class EligibilityService {
  constructor(private readonly repository = new EligibilityRepository()) {}
  evaluate(userId: string, input: Partial<EligibilityAnswers>) {
    if (!userId) throw new Error('ELIGIBILITY_USER_REQUIRED');
    const answers = validateEligibilityAnswers(input);
    const decision = decideEligibility(answers);
    return this.repository.save({ userId, answers, decision });
  }
}
