import { describe, expect, it, vi } from 'vitest';
import { handleUnauthorized } from '../handle-unauthorized';

describe('handleUnauthorized', () => {
  it('clears local session and redirects with returnTo via next=', async () => {
    const clearSessionLocal = vi.fn();
    const replace = vi.fn();
    await handleUnauthorized({
      clearSessionLocal,
      router: { replace },
      pathname: '/dashboard-today',
    });
    expect(clearSessionLocal).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fdashboard-today');
  });

  it('does not redirect when already on login (loop guard)', async () => {
    const clearSessionLocal = vi.fn();
    const replace = vi.fn();
    const original = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { pathname: '/login' } },
    });
    try {
      await handleUnauthorized({
        clearSessionLocal,
        router: { replace },
        pathname: '/login',
      });
      expect(clearSessionLocal).toHaveBeenCalledOnce();
      expect(replace).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: original });
    }
  });
});
