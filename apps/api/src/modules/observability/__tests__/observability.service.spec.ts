import { describe, expect, it } from 'vitest';
import {
  buildStructuredLog,
  classifyEvents,
  evaluateAlert,
  redactSensitive,
  validateAlertRule,
} from '../domain/observability.policy';
import { ObservabilityService } from '../application/observability.service';

describe('observability STEP_152–154', () => {
  it('classifies real audit actions into jobs, errors and audit stream', () => {
    const result = classifyEvents([
      { id: '1', action: 'worker.job.completed', metadata: {}, createdAt: '2026-01-01' },
      { id: '2', action: 'integration.failed', metadata: {}, createdAt: '2026-01-02' },
    ]);
    expect(result.jobs).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.audit).toHaveLength(2);
  });

  it('redacts secrets from structured log fields', () => {
    const record = buildStructuredLog('info', 'auth.login', {
      password: 'secret',
      token: 'abc',
      userId: 'u1',
      nested: { apiKey: 'k', ok: true },
    });
    expect(record.fields?.password).toBe('[REDACTED]');
    expect(record.fields?.token).toBe('[REDACTED]');
    expect(record.fields?.userId).toBe('u1');
    expect((record.fields?.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect((record.fields?.nested as Record<string, unknown>).ok).toBe(true);
    expect(() => buildStructuredLog('info', '  ')).toThrow('LOG_MESSAGE_INVALID');
  });

  it('deep-redacts arbitrary payloads', () => {
    expect(redactSensitive({ Authorization: 'Bearer x', safe: 1 })).toEqual({
      Authorization: '[REDACTED]',
      safe: 1,
    });
  });

  it('builds metrics and traces for dashboard', () => {
    const service = new ObservabilityService({} as never);
    const metrics = service.buildMetrics(2, 1, 4);
    expect(metrics.find((m) => m.name === 'errors.ratio')?.value).toBe(0.25);
    expect(service.buildTraces(1).some((t) => t.status === 'error')).toBe(true);
  });

  it('evaluates alert rules against metrics', () => {
    const rule = validateAlertRule({
      name: 'high-errors',
      metric: 'errors.count',
      threshold: 0,
      comparator: 'gt',
      enabled: true,
    });
    expect(evaluateAlert({ ...rule, id: 'r1' }, [{ name: 'errors.count', value: 2, unit: 'count' }])).toBe(true);
    expect(evaluateAlert({ ...rule, id: 'r1', enabled: false }, [{ name: 'errors.count', value: 2, unit: 'count' }])).toBe(
      false,
    );
    expect(() => validateAlertRule({ name: '', metric: 'x', threshold: 1, comparator: 'gt', enabled: true })).toThrow(
      'ALERT_RULE_INVALID',
    );
  });

  it('rejects USER role for operations', async () => {
    const service = new ObservabilityService({ events: async () => [] } as never);
    await expect(service.operationsForUser('u', 'USER')).rejects.toThrow('OWNER_ACCESS_FORBIDDEN');
  });
});
