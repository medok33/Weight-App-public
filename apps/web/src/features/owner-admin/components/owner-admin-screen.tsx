'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { getOwnerCatalog, getOwnerOverview, searchOwnerUsers } from '../api/owner-admin.client';
import type { OwnerCatalogItem, OwnerOverview, OwnerUserSearchResponse } from '../model/owner-admin.types';
import { useI18n } from '../../../i18n/locale-provider';

type State = 'loading' | 'error' | 'forbidden' | 'success';

export function OwnerAdminScreen() {
  const { t } = useI18n();
  const [state, setState] = useState<State>('loading');
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [catalog, setCatalog] = useState<OwnerCatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<OwnerUserSearchResponse['items']>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'empty' | 'error' | 'success'>('idle');

  useEffect(() => {
    Promise.all([getOwnerOverview(), getOwnerCatalog()])
      .then(([data, catalogData]) => {
        setOverview(data);
        setCatalog(catalogData.items);
        setState('success');
      })
      .catch((error: unknown) =>
        setState(error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN' ? 'forbidden' : 'error'),
      );
  }, []);

  async function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchState('loading');
    try {
      const result = await searchOwnerUsers(query);
      setUsers(result.items);
      setSearchState(result.total ? 'success' : 'empty');
    } catch {
      setSearchState('error');
    }
  }

  if (state === 'loading') {
    return (
      <main aria-busy="true">
        <h1>{t('admin.owner.title')}</h1>
        <p>{t('admin.owner.loading')}</p>
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main role="alert">
        <h1>{t('admin.owner.title')}</h1>
        <p>{t('admin.owner.forbidden')}</p>
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main role="alert">
        <h1>{t('admin.owner.title')}</h1>
        <p>{t('admin.owner.error')}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{t('admin.owner.title')}</h1>
      <p>{t('admin.owner.mfaOk')}</p>
      <section aria-label={t('admin.owner.overview')}>
        <h2>{t('admin.owner.overview')}</h2>
        <dl>
          <div>
            <dt>{t('admin.owner.users')}</dt>
            <dd>{overview?.metrics.users ?? 0}</dd>
          </div>
          <div>
            <dt>{t('admin.owner.activeSessions')}</dt>
            <dd>{overview?.metrics.activeSessions ?? 0}</dd>
          </div>
          <div>
            <dt>{t('admin.owner.auditEvents')}</dt>
            <dd>{overview?.metrics.auditEvents ?? 0}</dd>
          </div>
        </dl>
      </section>
      <section aria-label={t('admin.owner.catalog')}>
        <h2>{t('admin.owner.catalog')}</h2>
        {catalog.length === 0 ? (
          <p>{t('admin.owner.catalogEmpty')}</p>
        ) : (
          <ul>
            {catalog.map((item) => (
              <li key={item.id}>
                {item.canonicalName} ({item.unit})
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t('admin.owner.supportSearch')}>
        <h2>{t('admin.owner.supportSearch')}</h2>
        <form onSubmit={onSearch}>
          <label htmlFor="owner-user-query">{t('admin.owner.emailSearch')}</label>
          <input
            id="owner-user-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={2}
            maxLength={100}
          />
          <button type="submit" disabled={searchState === 'loading'}>
            {t('admin.owner.search')}
          </button>
        </form>
        {searchState === 'loading' && <p aria-busy="true">{t('admin.owner.searching')}</p>}
        {searchState === 'error' && <p role="alert">{t('admin.owner.searchError')}</p>}
        {searchState === 'empty' && <p>{t('admin.owner.usersNotFound')}</p>}
        {searchState === 'success' && (
          <ul>
            {users.map((user) => (
              <li key={user.id}>{user.email}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
