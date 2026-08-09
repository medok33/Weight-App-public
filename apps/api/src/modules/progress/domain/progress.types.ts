export type ProgressEntry = {
  id?: string;
  userId: string;
  weightKg: number;
  measuredAt: string;
};

export type Adherence = { score: number; completed: number; total: number };

export type ProgressSummary = {
  userId: string;
  latest: ProgressEntry | null;
  entries: ProgressEntry[];
  deltaKg: number | null;
};
