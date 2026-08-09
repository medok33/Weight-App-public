export type ProgressEntry = {
  id?: string;
  userId: string;
  weightKg: number;
  measuredAt: string;
};

export type ProgressSummary = {
  userId: string;
  latest: ProgressEntry | null;
  entries: ProgressEntry[];
  deltaKg: number | null;
};
