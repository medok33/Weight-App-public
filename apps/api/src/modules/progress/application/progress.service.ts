import { Inject, Injectable, Optional } from '@nestjs/common';
import { adherenceScore, validateEntry } from '../domain/progress.policy';
import type { ProgressEntry, ProgressSummary } from '../domain/progress.types';
import { ProgressRepository } from '../infrastructure/progress.repository';

@Injectable()
export class ProgressService {
  private readonly memory: ProgressEntry[] = [];

  constructor(@Optional() @Inject(ProgressRepository) private readonly repository?: ProgressRepository) {}

  async save(entry: ProgressEntry) {
    const validated = validateEntry({
      ...entry,
      measuredAt: entry.measuredAt || new Date().toISOString(),
    });
    if (this.repository) return this.repository.add(validated);
    this.memory.push(validated);
    return validated;
  }

  async list(userId: string) {
    if (!userId) throw new Error('PROGRESS_USER_REQUIRED');
    if (this.repository) return this.repository.listByUser(userId);
    return this.memory.filter((entry) => entry.userId === userId);
  }

  async summary(userId: string): Promise<ProgressSummary> {
    const entries = await this.list(userId);
    const latest = entries.length ? entries[entries.length - 1]! : null;
    const first = entries.length ? entries[0]! : null;
    return {
      userId,
      latest,
      entries,
      deltaKg: latest && first ? Number((latest.weightKg - first.weightKg).toFixed(1)) : null,
    };
  }

  adherence(completed: number, total: number) {
    return adherenceScore(completed, total);
  }
}
