export type RateLimitConfig = {
  windowMs: number;
  maxFailures: number;
};

export type RateLimitBucket = {
  failures: number;
  windowStartedAt: number;
};

export function assertWithinRateLimit(
  buckets: Map<string, RateLimitBucket>,
  key: string,
  config: RateLimitConfig,
  now = Date.now(),
  code = 'RATE_LIMITED',
): void {
  const bucket = buckets.get(key);
  if (!bucket) return;
  if (now - bucket.windowStartedAt > config.windowMs) {
    buckets.delete(key);
    return;
  }
  if (bucket.failures >= config.maxFailures) throw new Error(code);
}

export function recordRateLimitFailure(
  buckets: Map<string, RateLimitBucket>,
  key: string,
  config: RateLimitConfig,
  now = Date.now(),
): void {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartedAt > config.windowMs) {
    buckets.set(key, { failures: 1, windowStartedAt: now });
    return;
  }
  bucket.failures += 1;
}

export function clearRateLimit(buckets: Map<string, RateLimitBucket>, key: string): void {
  buckets.delete(key);
}

export const LOGIN_BRUTE_FORCE: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  maxFailures: 8,
};
