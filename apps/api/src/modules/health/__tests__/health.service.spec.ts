import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HealthService } from '../health.service';

describe('HealthService readiness', () => {
  const query = vi.fn();
  const service = new HealthService({ query } as never);

  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  });

  it('is not ready when postgres is down', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    const result = await service.readiness();
    expect(result.ready).toBe(false);
    expect(result.status).toBe('not_ready');
    expect(result.checks.postgres).toBe(false);
  });

  it('is ready with degraded status when postgres is up and redis is down', async () => {
    const prev = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:63999';
    try {
      const result = await service.readiness();
      expect(result.ready).toBe(true);
      expect(result.status).toBe('degraded');
      expect(result.checks.postgres).toBe(true);
      expect(result.checks.redis).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = prev;
    }
  });
});
