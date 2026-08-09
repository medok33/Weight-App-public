'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';
import { LoadingState } from '@/components/ui-state';
import { isAuthEntryPath, loginUrlWithReturnTo } from '@/lib/session-redirect';
import { RequireOnboarding } from '@/features/onboarding/components/require-onboarding';
import { useI18n } from '@/i18n/locale-provider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  useEffect(() => {
    if (status !== 'anonymous') return;
    if (isAuthEntryPath(pathname || '/')) return;
    router.replace(loginUrlWithReturnTo(pathname || '/dashboard-today'));
  }, [status, router, pathname]);

  if (status === 'loading') {
    return (
      <main data-testid="auth-loading">
        <LoadingState message={t('ui.sessionChecking')} testId="auth-loading-state" />
      </main>
    );
  }

  if (status === 'anonymous') {
    return (
      <main data-testid="auth-redirect">
        <LoadingState message={t('ui.sessionRedirect')} testId="auth-redirect-state" />
      </main>
    );
  }

  return <RequireOnboarding>{children}</RequireOnboarding>;
}
