'use client';

import { isAuthEntryPath, loginUrlWithReturnTo } from './session-redirect';

type RouterLike = { replace: (href: string) => void };

/**
 * Clear local session and send the user to /login with a safe return path.
 * No-ops when already on an auth entry route (prevents redirect loops).
 */
export async function handleUnauthorized(options: {
  clearSessionLocal: () => void | Promise<void>;
  router: RouterLike;
  pathname: string;
}): Promise<void> {
  await options.clearSessionLocal();
  if (typeof window !== 'undefined' && isAuthEntryPath(window.location.pathname)) {
    return;
  }
  if (isAuthEntryPath(options.pathname)) {
    return;
  }
  options.router.replace(loginUrlWithReturnTo(options.pathname));
}
