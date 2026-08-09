import { describe, expect, it } from 'vitest';

describe('payments screen contract', () => {
  it('maps payment statuses to UX outcomes', () => {
    const map = (status: string) =>
      status === 'succeeded' ? 'success' : status === 'failed' || status === 'cancelled' ? 'failure' : 'pending';
    expect(map('succeeded')).toBe('success');
    expect(map('failed')).toBe('failure');
    expect(map('pending')).toBe('pending');
  });
});
