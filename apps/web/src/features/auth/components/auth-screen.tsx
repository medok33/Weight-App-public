'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './auth-provider';
import { ApiError } from '@/lib/api-fetch';
import { readReturnToParam, safeReturnTo } from '@/lib/session-redirect';
import { LoadingState } from '@/components/ui-state';
import { useI18n } from '@/i18n/locale-provider';
import { resolvePostAuthDestination } from '@/features/onboarding/lib/onboarding-gate';

type AuthMode = 'login' | 'register';

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, register, status, user } = useAuth();
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const errorId = useId();
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const safeNext = readReturnToParam(searchParams);

  // Drop unsafe next/returnTo from the address bar (open-redirect / XSS vectors).
  useEffect(() => {
    const raw = searchParams.get('returnTo') ?? searchParams.get('next');
    if (raw == null || raw === '') return;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    const safe = safeReturnTo(raw);
    if (safe === decoded.trim() || safe === raw.trim()) return;
    router.replace(safe === '/dashboard-today' ? `/${mode}` : `/${mode}?next=${encodeURIComponent(safe)}`);
  }, [searchParams, mode, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    void (async () => {
      const dest = await resolvePostAuthDestination(user?.role, safeNext);
      if (!cancelled) router.replace(dest);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, router, safeNext, user?.role]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const nextUser =
        mode === 'register' ? await register(identifier, password) : await login(identifier, password);
      const dest = await resolvePostAuthDestination(nextUser.role, safeNext);
      router.replace(dest);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t('auth.rateLimited'));
      } else if (err instanceof ApiError && err.status === 400) {
        setError(
          mode === 'register'
            ? t('auth.registerInvalid')
            : t('auth.invalidCredentials'),
        );
      } else {
        setError(mode === 'register' ? t('auth.registerFailed') : t('auth.invalidCredentials'));
      }
      // Move focus to the first field so the error is discoverable by keyboard / SR.
      queueMicrotask(() => {
        const target = !identifier.trim() ? identifierRef.current : passwordRef.current ?? identifierRef.current;
        target?.focus();
      });
    } finally {
      setLoading(false);
    }
  }

  if (status === 'loading' || status === 'authenticated') {
    return (
      <main data-testid={`auth-${mode}`}>
        <LoadingState message={t('common.loading')} testId={`auth-${mode}-loading`} />
      </main>
    );
  }

  const describedBy = error ? errorId : undefined;

  return (
    <main data-testid={`auth-${mode}`}>
      <h1>{mode === 'register' ? t('auth.registerTitle') : t('auth.loginTitle')}</h1>
      <p data-testid="auth-hint" id={`${errorId}-hint`}>
        {mode === 'register'
          ? t('auth.registerHint')
          : t('auth.loginHint')}
      </p>
      <form onSubmit={onSubmit} noValidate={false}>
        <label htmlFor="identifier">{mode === 'register' ? t('auth.registerIdentifier') : t('auth.loginIdentifier')}</label>
        <input
          id="identifier"
          ref={identifierRef}
          data-testid="auth-email"
          name="identifier"
          type={mode === 'register' ? 'email' : 'text'}
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <label htmlFor="password">{t('auth.password')}</label>
        <input
          id="password"
          ref={passwordRef}
          data-testid="auth-password"
          name="password"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {error ? (
          <p id={errorId} role="alert" data-testid="auth-error">
            {error}
          </p>
        ) : null}
        <button type="submit" data-testid="auth-submit" disabled={loading} aria-busy={loading || undefined}>
          {loading ? t('auth.wait') : mode === 'register' ? t('auth.register') : t('auth.login')}
        </button>
      </form>
    </main>
  );
}
