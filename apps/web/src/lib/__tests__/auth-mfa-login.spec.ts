import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

vi.mock('../user-context', () => ({
  getStoredUserId: () => null,
  clearStoredUserId: vi.fn(),
}));

import { clearAuthCache, login } from '../auth';

describe('OWNER password login via same-origin BFF', () => {
  afterEach(() => {
    clearAuthCache();
    fetchMock.mockReset();
  });

  it('posts to /api/auth/login then loads /api/auth/me on the web origin', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ user: { id: 'o1', role: 'OWNER' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'o1', role: 'OWNER', username: 'zapolnaya28', email: null }),
      });

    await expect(login('zapolnaya28', 'Password12345!')).resolves.toMatchObject({
      role: 'OWNER',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/me');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });
});
