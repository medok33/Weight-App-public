import { describe, expect, it, vi } from 'vitest';
import { AuthRepository } from '../infrastructure/auth.repository';

describe('last owner protection', () => {
  it('blocks demoting the last OWNER', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('count(*)')) return { rows: [{ count: '1' }] };
        if (sql.includes('FROM "User" WHERE id')) {
          return { rows: [{ accountRole: 'OWNER', status: 'ACTIVE' }] };
        }
        return { rows: [] };
      }),
    };
    const repo = new AuthRepository(db as never);
    await expect(repo.setAccountRole('actor', 'target', 'ADMIN')).rejects.toThrow('LAST_OWNER_PROTECTED');
  });

  it('blocks assigning OWNER via setAccountRole', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const repo = new AuthRepository(db as never);
    await expect(repo.setAccountRole('actor', 'target', 'OWNER')).rejects.toThrow('OWNER_ASSIGN_FORBIDDEN');
  });

  it('blocks deactivating the last OWNER', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('count(*)')) return { rows: [{ count: '1' }] };
        if (sql.includes('FROM "User" WHERE id')) return { rows: [{ accountRole: 'OWNER' }] };
        return { rows: [] };
      }),
    };
    const repo = new AuthRepository(db as never);
    await expect(repo.deactivateUser('actor', 'target')).rejects.toThrow('LAST_OWNER_PROTECTED');
  });
});

describe('credential lookup', () => {
  it('resolves identifier by username or email without leaking existence', async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [{ userId: 'u1', credentialHash: 'salt:hash', status: 'ACTIVE' }],
      })),
    };
    const repo = new AuthRepository(db as never);
    const found = await repo.findCredential('OwnerLogin');
    expect(found?.userId).toBe('u1');
    expect(db.query.mock.calls[0]?.[0]).toContain('username');
    expect(db.query.mock.calls[0]?.[0]).toContain('email');
  });
});
