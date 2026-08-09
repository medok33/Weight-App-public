import type { Adherence, ProgressEntry } from './progress.types';

export function validateEntry(entry: ProgressEntry): ProgressEntry {
  if (!entry.userId) throw new Error('PROGRESS_ENTRY_INVALID');
  if (!Number.isFinite(entry.weightKg) || entry.weightKg < 35 || entry.weightKg > 250) {
    throw new Error('PROGRESS_ENTRY_INVALID');
  }
  if (!entry.measuredAt || Number.isNaN(Date.parse(entry.measuredAt))) {
    throw new Error('PROGRESS_ENTRY_INVALID');
  }
  return entry;
}

export function adherenceScore(completed: number, total: number): Adherence {
  if (total < 0 || completed < 0 || completed > total) throw new Error('ADHERENCE_INVALID');
  return { completed, total, score: total === 0 ? 0 : Math.round((completed / total) * 100) };
}
