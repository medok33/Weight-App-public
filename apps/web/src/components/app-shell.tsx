'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/locale-provider';
import { useAuth } from '../features/auth/components/auth-provider';
import { resolveAppShellNav } from '../lib/app-shell-nav';

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const nav = resolveAppShellNav(user?.role, pathname);

  async function onLogout() {
    await logout();
    router.push('/login');
  }

  function navLinkProps(href: string) {
    const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
    return {
      'aria-current': active ? ('page' as const) : undefined,
      'data-active': active ? 'true' : undefined,
    };
  }

  return (
    <>
      <a href="#main-content" className="skip-link" data-testid="skip-to-content">
        {t('a11y.skipToContent')}
      </a>
      <div className="app-shell">
      <aside className="app-nav" aria-label={t('brand')}>
        <div className="app-brand" data-testid="app-brand">
          {t('brand')}
        </div>
        <nav aria-label={t('home.navigation')}>
          {nav.showAdminWorkspaceNav ? (
            <ul data-testid="admin-navigation">
              <li>
                <Link href="/admin/content" data-testid="nav-admin-content" {...navLinkProps('/admin/content')}>
                  {t('nav.adminContent')}
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/recipe-coverage"
                  data-testid="nav-admin-coverage"
                  {...navLinkProps('/admin/recipe-coverage')}
                >
                  {t('nav.adminCoverage')}
                </Link>
              </li>
              <li>
                <Link href="/admin/recipes" data-testid="nav-admin-recipes" {...navLinkProps('/admin/recipes')}>
                  {t('nav.adminRecipes')}
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/recipe-revalidation"
                  data-testid="nav-admin-revalidation"
                  {...navLinkProps('/admin/recipe-revalidation')}
                >
                  {t('nav.adminRevalidation')}
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/recipe-duplicates"
                  data-testid="nav-admin-duplicates"
                  {...navLinkProps('/admin/recipe-duplicates')}
                >
                  {t('nav.adminDuplicates')}
                </Link>
              </li>
              <li>
                <Link href="/admin/media" data-testid="nav-admin-media" {...navLinkProps('/admin/media')}>
                  {t('nav.adminMedia')}
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/recipe-sources"
                  data-testid="nav-admin-recipe-sources"
                  {...navLinkProps('/admin/recipe-sources')}
                >
                  {t('nav.adminRecipeSources')}
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/recipe-research"
                  data-testid="nav-admin-recipe-research"
                  {...navLinkProps('/admin/recipe-research')}
                >
                  {t('nav.adminRecipeResearch')}
                </Link>
              </li>
              <li>
                <Link href="/admin/products" data-testid="nav-admin-products" {...navLinkProps('/admin/products')}>
                  {t('nav.adminProducts')}
                </Link>
              </li>
              <li>
                <Link href="/price-intelligence" data-testid="nav-prices" {...navLinkProps('/price-intelligence')}>
                  {t('nav.prices')}
                </Link>
              </li>
              <li>
                <Link href="/owner-admin" data-testid="nav-users" {...navLinkProps('/owner-admin')}>
                  {t('nav.adminUsers')}
                </Link>
              </li>
              <li>
                <Link href="/observability" data-testid="nav-system-status" {...navLinkProps('/observability')}>
                  {t('nav.systemStatus')}
                </Link>
              </li>
              {nav.showOwnerOnlyLinks ? (
                <>
                  <li>
                    <Link
                      href="/owner-admin/feature-flags"
                      data-testid="nav-owner-feature-flags"
                      {...navLinkProps('/owner-admin/feature-flags')}
                    >
                      {t('owner.featureFlags')}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/owner-admin/reauth"
                      data-testid="nav-owner-reauth"
                      {...navLinkProps('/owner-admin/reauth')}
                    >
                      {t('owner.reauth')}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/owner/operations"
                      data-testid="nav-owner-operations"
                      {...navLinkProps('/owner/operations')}
                    >
                      {t('owner.operations')}
                    </Link>
                  </li>
                </>
              ) : null}
              <li>
                <Link href="/dashboard-today" data-testid="nav-back-to-app" {...navLinkProps('/dashboard-today')}>
                  {t('nav.backToApp')}
                </Link>
              </li>
            </ul>
          ) : (
            <ul data-testid="user-navigation">
              <li>
                <Link href="/dashboard-today" data-testid="nav-today" {...navLinkProps('/dashboard-today')}>
                  {t('nav.today')}
                </Link>
              </li>
              <li>
                <Link href="/meal-plan" data-testid="nav-nutrition" {...navLinkProps('/meal-plan')}>
                  {t('nav.nutrition')}
                </Link>
              </li>
              <li>
                <Link href="/workout-engine" data-testid="nav-workouts" {...navLinkProps('/workout-engine')}>
                  {t('nav.workouts')}
                </Link>
              </li>
              <li>
                <Link href="/shopping-list" data-testid="nav-shopping" {...navLinkProps('/shopping-list')}>
                  {t('nav.shopping')}
                </Link>
              </li>
              <li>
                <Link href="/pantry" data-testid="nav-pantry" {...navLinkProps('/pantry')}>
                  {t('nav.pantry')}
                </Link>
              </li>
              <li>
                <Link href="/budget-mode" data-testid="nav-budget-mode" {...navLinkProps('/budget-mode')}>
                  {t('nav.budget')}
                </Link>
              </li>
              <li>
                <Link href="/progress" data-testid="nav-progress" {...navLinkProps('/progress')}>
                  {t('nav.progress')}
                </Link>
              </li>
              <li>
                <Link href="/assistant" data-testid="nav-assistant" {...navLinkProps('/assistant')}>
                  {t('nav.assistant')}
                </Link>
              </li>
              {nav.showAdminEntry ? (
                <li>
                  <Link href="/admin/content" data-testid="nav-admin-entry" {...navLinkProps('/admin/content')}>
                    {t('nav.adminEntry')}
                  </Link>
                </li>
              ) : null}
              {nav.showOwnerOnlyLinks ? (
                <li>
                  <Link
                    href="/owner-admin/feature-flags"
                    data-testid="nav-owner-entry"
                    {...navLinkProps('/owner-admin/feature-flags')}
                  >
                    {t('owner.entry')}
                  </Link>
                </li>
              ) : null}
              <li>
                <Link href="/settings" data-testid="nav-profile" {...navLinkProps('/settings')}>
                  {t('nav.profile')}
                </Link>
              </li>
              <li>
                <Link href="/settings" data-testid="nav-settings" {...navLinkProps('/settings')}>
                  {t('nav.settings')}
                </Link>
              </li>
            </ul>
          )}
        </nav>
        <div className="app-nav-session" style={{ marginTop: '1rem', fontSize: 12 }}>
          {status === 'authenticated' && user ? (
            <>
              <p data-testid="auth-user-email">{user.email}</p>
              {nav.showOwnerBadge ? <p data-testid="auth-role-badge">OWNER</p> : null}
              <button type="button" data-testid="auth-logout" onClick={onLogout}>
                {t('auth.logout')}
              </button>
            </>
          ) : status === 'anonymous' ? (
            <p>
              <Link href="/login" data-testid="nav-login">
                {t('auth.loginTitle')}
              </Link>
              {' · '}
              <Link href="/register" data-testid="nav-register">
                {t('auth.registerTitle')}
              </Link>
            </p>
          ) : (
            <p data-testid="nav-auth-loading">{t('common.loading')}</p>
          )}
        </div>
      </aside>
      <div className="app-content" id="main-content" tabIndex={-1} data-testid="main-content">
        {children}
      </div>
    </div>
    </>
  );
}
