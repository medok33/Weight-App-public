'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/components/auth-provider';
import { LoadingState, InlineNotice, RetryAction } from '@/components/ui-state';
import { useI18n } from '@/i18n/locale-provider';
import { handleUnauthorized } from '@/lib/handle-unauthorized';
import { ApiError } from '@/lib/api-fetch';
import {
  getOnboardingCompletionStatus,
  isOnboardingExemptPath,
  shouldBypassUserOnboarding,
} from '../lib/onboarding-gate';

/**
 * Soft/hard gate: USER without profile+goal is sent to /onboarding.
 * Transient API failures fail OPEN (allow) — never treated as incomplete.
 * OWNER/ADMIN workspace and /onboarding|/settings are exempt — no redirect loops.
 */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { status, user, clearSessionLocal } = useAuth();
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { t } = useI18n();
  const [gate, setGate] = useState<'loading' | 'allow' | 'redirect' | 'unknown'>('loading');
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (status === 'loading') {
        setGate('loading');
        return;
      }
      if (status !== 'authenticated') {
        setGate('allow');
        return;
      }
      if (shouldBypassUserOnboarding(user?.role) || isOnboardingExemptPath(pathname)) {
        if (!cancelled) setGate('allow');
        return;
      }
      try {
        const completion = await getOnboardingCompletionStatus();
        if (cancelled) return;
        if (completion === 'complete') {
          setGate('allow');
          return;
        }
        if (completion === 'unknown') {
          setGate('unknown');
          return;
        }
        setGate('redirect');
        router.replace('/onboarding');
      } catch (error: unknown) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          await handleUnauthorized({ clearSessionLocal, router, pathname });
          return;
        }
        setGate('unknown');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [status, user?.role, pathname, router, clearSessionLocal, retryToken]);

  if (status === 'authenticated' && gate === 'loading') {
    return (
      <main data-testid="onboarding-gate-loading">
        <LoadingState message={t('common.loading')} testId="onboarding-gate-loading-state" />
      </main>
    );
  }

  if (gate === 'redirect') {
    return (
      <main data-testid="onboarding-gate-redirect">
        <LoadingState message={t('onboarding.redirecting')} testId="onboarding-gate-redirect-state" />
      </main>
    );
  }

  if (gate === 'unknown') {
    return (
      <>
        <div style={{ maxWidth: 640, margin: '0 auto 12px', padding: '0 12px' }} data-testid="onboarding-gate-unknown">
          <InlineNotice tone="warning" message={t('onboarding.gateUnknown')} testId="onboarding-gate-unknown-notice">
            <RetryAction
              label={t('common.retry')}
              onRetry={() => {
                setGate('loading');
                setRetryToken((n) => n + 1);
              }}
              testId="onboarding-gate-retry"
            />
          </InlineNotice>
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
}
