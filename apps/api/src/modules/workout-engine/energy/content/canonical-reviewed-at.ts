const CANONICAL_REVIEWED_AT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Canonical manifest reviewedAt: UTC calendar date YYYY-MM-DD only. */
export function isCanonicalReviewedAt(value: unknown): boolean {
  if (typeof value !== 'string' || !CANONICAL_REVIEWED_AT_RE.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}
