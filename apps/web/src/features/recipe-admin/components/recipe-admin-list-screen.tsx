'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '../../../i18n/locale-provider';
import type { AdminMessageKey } from '../../../i18n/admin-message-keys';
import { labelOrEnum } from '../../../i18n/admin-label';

type RecipeRow = {
  id: string;
  name: string;
  recipeKey: string | null;
  dataClass?: string;
  dataClassLabelRu?: string;
  familyName: string | null;
  currentVersionNumber: number | null;
  lifecycleStatus: string | null;
  lifecycleLabelRu?: string;
  validationStatus: string | null;
  coverageAssignedCount?: number;
  duplicateStatus?: string;
  revalidationOpen?: boolean;
  mediaStatus?: string;
  unresolvedDependencyCount?: number;
  updatedAt?: string;
};

const DATA_CLASS_KEYS: Record<string, AdminMessageKey> = {
  PRODUCTION: 'admin.recipes.dataClass.PRODUCTION',
  TEST_ONLY: 'admin.recipes.dataClass.TEST_ONLY',
  HISTORICAL_ONLY: 'admin.recipes.dataClass.HISTORICAL_ONLY',
  FIXTURE: 'admin.recipes.dataClass.FIXTURE',
  LEGACY: 'admin.recipes.dataClass.LEGACY',
  'TEST_ONLY,HISTORICAL_ONLY,FIXTURE,LEGACY': 'admin.recipes.dataClass.TEST_MIX',
  ALL: 'admin.recipes.dataClass.ALL',
};

const VALIDATION_KEYS: Record<string, AdminMessageKey> = {
  VALID: 'admin.recipes.validation.VALID',
  NEEDS_REVALIDATION: 'admin.recipes.validation.NEEDS_REVALIDATION',
  BLOCKED: 'admin.recipes.validation.BLOCKED',
};

export function RecipeAdminListScreen() {
  const { t } = useI18n();
  const [items, setItems] = useState<RecipeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'error' | 'forbidden' | 'success'>('loading');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const query = searchParams.toString();
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(searchParams.get('pageSize') ?? '25');
  const dataClass = searchParams.get('dataClass') ?? 'PRODUCTION';
  const qDefault = searchParams.get('q') ?? '';
  const [qDraft, setQDraft] = useState(qDefault);

  useEffect(() => {
    setQDraft(qDefault);
  }, [qDefault]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (qDraft === qDefault) return;
      const params = new URLSearchParams(searchParams.toString());
      if (qDraft.trim()) params.set('q', qDraft.trim());
      else params.delete('q');
      params.set('page', '1');
      if (!params.has('dataClass')) params.set('dataClass', 'PRODUCTION');
      router.replace(`${pathname}?${params.toString()}`);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [qDraft, qDefault, pathname, router, searchParams]);

  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams(query);
        if (!params.has('dataClass')) params.set('dataClass', 'PRODUCTION');
        const response = await fetch(`/api/admin/recipes?${params.toString()}`, { cache: 'no-store' });
        if (response.status === 401 || response.status === 403) {
          setState('forbidden');
          return;
        }
        if (!response.ok) throw new Error('load_failed');
        const data = (await response.json()) as { items?: RecipeRow[]; total?: number };
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setState('success');
      } catch {
        setState('error');
      }
    })();
  }, [query]);

  function update(values: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(values).forEach(([key, item]) => (item ? params.set(key, item) : params.delete(key)));
    if (!('page' in values)) params.set('page', '1');
    if (!params.has('dataClass')) params.set('dataClass', 'PRODUCTION');
    router.replace(`${pathname}?${params.toString()}`);
  }

  const emptyHint = useMemo(() => {
    if (items.length) return null;
    if (dataClass === 'PRODUCTION') return t('admin.recipes.emptyProduction');
    return t('admin.recipes.emptyOther');
  }, [items.length, dataClass, t]);

  if (state === 'loading') {
    return (
      <main className="admin-workspace" aria-busy="true" data-testid="admin-recipes-loading">
        {t('admin.recipes.loading')}
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main className="admin-workspace" data-testid="admin-recipes-forbidden">
        {t('admin.recipes.forbidden')}
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main className="admin-workspace" role="alert">
        <p>{t('admin.recipes.unavailable')}</p>
        <button type="button" onClick={() => router.refresh()}>
          {t('admin.common.retry')}
        </button>
      </main>
    );
  }

  return (
    <main className="admin-workspace" data-testid="admin-recipes-list">
      <h1>{t('nav.adminRecipes')}</h1>
      <p>
        <span className="admin-chip" data-testid="recipe-data-class-filter">
          {t('admin.recipes.activeFilter')}: {labelOrEnum(t, dataClass, DATA_CLASS_KEYS, undefined)}
        </span>{' '}
        <span data-testid="recipe-list-total">
          {t('admin.recipes.totalFiltered')}: {total}
        </span>
      </p>
      <div className="admin-toolbar">
        <label>
          {t('admin.recipes.search')}
          <input
            aria-label="Поиск по названию или ключу"
            value={qDraft}
            onChange={(event) => setQDraft(event.target.value)}
          />
        </label>
        <label>
          {t('admin.recipes.dataClass')}
          <select
            aria-label={t('admin.recipes.dataClass')}
            value={dataClass}
            onChange={(event) => update({ dataClass: event.target.value })}
            data-testid="recipe-data-class-select"
          >
            {Object.keys(DATA_CLASS_KEYS).map((code) => (
              <option key={code} value={code}>
                {t(DATA_CLASS_KEYS[code])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.recipes.lifecycle')}
          <select
            value={searchParams.get('lifecycle') ?? ''}
            onChange={(event) => update({ lifecycle: event.target.value || undefined })}
          >
            <option value="">{t('admin.common.all')}</option>
            <option value="IN_REVIEW">На проверке</option>
            <option value="APPROVED">Одобрена</option>
            <option value="PUBLISHED">Опубликована</option>
            <option value="SUPERSEDED">Заменена новой</option>
            <option value="SUSPENDED">Приостановлена</option>
            <option value="ARCHIVED">Архивирована</option>
            <option value="REJECTED">Отклонена</option>
          </select>
        </label>
        <label>
          {t('admin.recipes.validation')}
          <select
            value={searchParams.get('validation') ?? ''}
            onChange={(event) => update({ validation: event.target.value || undefined })}
          >
            <option value="">{t('admin.common.all')}</option>
            {Object.keys(VALIDATION_KEYS).map((code) => (
              <option key={code} value={code}>
                {t(VALIDATION_KEYS[code])}
              </option>
            ))}
          </select>
        </label>
      </div>
      {emptyHint ? <p data-testid="admin-recipes-empty">{emptyHint}</p> : null}
      <div className="admin-grid">
        <table data-testid="admin-recipes-grid" aria-label={t('nav.adminRecipes')}>
          <thead>
            <tr>
              <th scope="col">{t('admin.recipes.col.name')}</th>
              <th scope="col">{t('admin.product.col.key')}</th>
              <th scope="col">{t('admin.recipes.col.family')}</th>
              <th scope="col">{t('admin.recipes.col.version')}</th>
              <th scope="col">{t('admin.recipes.col.lifecycle')}</th>
              <th scope="col">{t('admin.recipes.col.validation')}</th>
              <th scope="col">{t('admin.recipes.col.coverage')}</th>
              <th scope="col">{t('admin.recipes.col.duplicate')}</th>
              <th scope="col">{t('admin.recipes.col.revalidation')}</th>
              <th scope="col">{t('admin.recipes.col.media')}</th>
              <th scope="col">{t('admin.recipes.col.dependencies')}</th>
              <th scope="col">{t('admin.recipes.col.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((recipe) => (
              <tr key={recipe.id}>
                <td>
                  <Link href={`/admin/recipes/${recipe.id}`} data-testid={`admin-recipe-${recipe.recipeKey ?? recipe.id}`}>
                    {recipe.name}
                  </Link>
                </td>
                <td>{recipe.recipeKey ?? '—'}</td>
                <td>{recipe.familyName ?? '—'}</td>
                <td>{recipe.currentVersionNumber != null ? `v${recipe.currentVersionNumber}` : '—'}</td>
                <td>{recipe.lifecycleLabelRu ?? recipe.lifecycleStatus ?? '—'}</td>
                <td>
                  {recipe.validationStatus
                    ? labelOrEnum(t, recipe.validationStatus, VALIDATION_KEYS)
                    : '—'}
                </td>
                <td>{recipe.coverageAssignedCount ?? 0}</td>
                <td>{recipe.duplicateStatus === 'BLOCKER_OPEN' ? t('admin.recipes.duplicateBlocker') : t('admin.recipes.duplicateNone')}</td>
                <td>{recipe.revalidationOpen ? t('admin.recipes.revalidationOpen') : t('admin.recipes.revalidationNone')}</td>
                <td>{recipe.mediaStatus === 'MISSING' ? t('admin.recipes.mediaMissing') : t('admin.recipes.mediaOk')}</td>
                <td>{recipe.unresolvedDependencyCount ?? 0}</td>
                <td>{recipe.updatedAt ? new Date(recipe.updatedAt).toLocaleString('ru-RU') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
          {t('admin.common.prev')}
        </button>
        <span>
          {t('admin.recipes.page')} {page} · {t('admin.recipes.pageSize')} {pageSize}
        </span>
        <button
          type="button"
          disabled={page * pageSize >= total}
          onClick={() => update({ page: String(page + 1) })}
        >
          {t('admin.common.next')}
        </button>
      </div>
    </main>
  );
}
