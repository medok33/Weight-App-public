import type { EligibilityAnswers, EligibilityDecision } from '../domain/eligibility.types';

export type EligibilityRecord = { userId: string; answers: EligibilityAnswers; decision: EligibilityDecision };

export class EligibilityRepository {
  private readonly records: EligibilityRecord[] = [];
  save(record: EligibilityRecord): EligibilityRecord { this.records.push(record); return record; }
  latestForUser(userId: string): EligibilityRecord | undefined { return [...this.records].reverse().find((record) => record.userId === userId); }
}
