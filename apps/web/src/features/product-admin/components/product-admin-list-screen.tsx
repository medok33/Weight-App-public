'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '../../../i18n/locale-provider';
import { createAdminProduct, getAdminProductMeta, listAdminProducts, type AdminProductListItem, type AdminProductMeta } from '../api/product-admin.client';

export function ProductAdminListScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<AdminProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<AdminProductMeta | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'forbidden' | 'success'>('loading');
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({
    canonicalName: '',
    productKey: '',
    categoryId: '',
    form: 'RAW',
    defaultUnit: 'g',
    confirmPossibleDuplicate: false,
  });

  const page = Number(searchParams.get('page') ?? '1');
  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.get('page')) params.set('page', '1');
    if (!params.get('pageSize')) params.set('pageSize', '25');
    return params;
  }, [searchParams]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [list, metaData] = await Promise.all([listAdminProducts(queryString), getAdminProductMeta()]);
      setItems(list.items);
      setTotal(list.total);
      setMeta(metaData);
      setState('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setState(message === 'OWNER_ACCESS_FORBIDDEN' || message === 'MFA_REQUIRED' || message === 'OWNER_ROLE_REQUIRED' ? 'forbidden' : 'error');
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const currentQ = searchParams.get('q') ?? '';
      if (q === currentQ) return;
      const next = new URLSearchParams(searchParams.toString());
      if (q) next.set('q', q);
      else next.delete('q');
      next.set('page', '1');
      router.replace(`${pathname}?${next.toString()}`);
    }, 300);
    return () => clearTimeout(handle);
  }, [q, pathname, router, searchParams]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    router.replace(`${pathname}?${next.toString()}`);
  }

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await createAdminProduct({
        ...form,
        categoryId: form.categoryId || meta?.categories[0]?.id,
      });
      setCreateOpen(false);
      router.push(`/admin/products/${created.id}`);
    } catch (error) {
      const err = error as Error & { body?: { code?: string; similar?: unknown[] } };
      if (err.body?.code === 'PRODUCT_POSSIBLE_DUPLICATE' || err.message.includes('PRODUCT_POSSIBLE_DUPLICATE')) {
        setCreateError('Возможный дубль. Подтвердите создание ещё раз.');
        setForm((f) => ({ ...f, confirmPossibleDuplicate: true }));
        return;
      }
      setCreateError(err.message);
    }
  }

  if (state === 'forbidden') {
    return (
      <main data-testid="admin-products-forbidden">
        <h1>{t('admin.product.title')}</h1>
        <p>{t('admin.product.mfaRequired')}</p>
      </main>
    );
  }

  return (
    <main data-testid="admin-products-page" style={{ padding: '1rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{t('admin.product.title')}</h1>
        <Link href="/admin/product-review" data-testid="nav-product-review">
          {t('admin.product.reviewQueues')}
        </Link>
        <Link href="/admin/product-duplicates" data-testid="nav-product-duplicates">
          {t('admin.product.duplicatesNav')}
        </Link>
        <Link href="/owner-admin">{t('admin.product.ownerAdmin')}</Link>
        <button type="button" data-testid="admin-product-create-open" onClick={() => setCreateOpen(true)}>
          {t('admin.product.create')}
        </button>
      </header>

      <section style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
        <label>
          {t('admin.product.search')}
          <input data-testid="admin-product-search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          Category
          <select
            data-testid="admin-product-filter-category"
            value={searchParams.get('categoryId') ?? ''}
            onChange={(e) => setFilter('categoryId', e.target.value)}
          >
            <option value="">{t('admin.common.all')}</option>
            {meta?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.product.form')}
          <select value={searchParams.get('form') ?? ''} onChange={(e) => setFilter('form', e.target.value)}>
            <option value="">{t('admin.common.all')}</option>
            {meta?.forms.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.product.nutrition')}
          <select value={searchParams.get('nutrition') ?? ''} onChange={(e) => setFilter('nutrition', e.target.value)}>
            <option value="">{t('admin.common.all')}</option>
            <option value="VERSIONED">VERSIONED</option>
            <option value="UNVERSIONED_LEGACY">UNVERSIONED_LEGACY</option>
            <option value="MISSING">MISSING</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={searchParams.get('unclassified') === '1'}
            onChange={(e) => setFilter('unclassified', e.target.checked ? '1' : '')}
          />{' '}
          {t('admin.product.unclassified')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={searchParams.get('roleMissing') === '1'}
            onChange={(e) => setFilter('roleMissing', e.target.checked ? '1' : '')}
          />{' '}
          {t('admin.product.roleMissing')}
        </label>
      </section>

      {state === 'loading' && <p aria-busy="true">{t('admin.product.loading')}</p>}
      {state === 'error' && <p role="alert">{t('admin.product.loadError')}</p>}
      {state === 'success' && items.length === 0 && <p data-testid="admin-products-empty">{t('admin.product.empty')}</p>}

      {items.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table
            data-testid="admin-products-table"
            aria-label={t('nav.adminProducts')}
            style={{ width: '100%', borderCollapse: 'collapse' }}
          >
            <thead>
              <tr>
                <th scope="col">{t('admin.product.col.name')}</th>
                <th scope="col">{t('admin.product.col.key')}</th>
                <th scope="col">{t('admin.product.col.category')}</th>
                <th scope="col">{t('admin.product.col.form')}</th>
                <th scope="col">{t('admin.product.col.dataset')}</th>
                <th scope="col">{t('admin.product.col.nutrition')}</th>
                <th scope="col">{t('admin.product.col.aliases')}</th>
                <th scope="col">{t('admin.product.col.roles')}</th>
                <th scope="col">{t('admin.product.col.retail')}</th>
                <th scope="col">{t('admin.product.col.price')}</th>
                <th scope="col">{t('admin.product.col.review')}</th>
                <th scope="col">{t('admin.product.col.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} data-testid={`admin-product-row-${item.id}`}>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Link href={`/admin/products/${item.id}`} data-testid={`admin-product-link-${item.id}`}>
                      {item.canonicalName}
                    </Link>
                  </td>
                  <td>{item.productKey}</td>
                  <td>{item.categoryCode}</td>
                  <td>{item.form}</td>
                  <td data-testid={`admin-product-dataset-${item.id}`}>{item.seedDatasetVersion ?? '—'}</td>
                  <td>{item.nutritionStatus}</td>
                  <td>{item.aliasesCount}</td>
                  <td>{item.culinaryRoles.join(', ')}</td>
                  <td>{item.retailProductCount}</td>
                  <td>{item.priceCoverage}</td>
                  <td>{item.reviewStatus}</td>
                  <td>{new Date(item.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setFilter('page', String(page - 1))}
        >
          {t('admin.common.prev')}
        </button>
        <span data-testid="admin-products-page-info">
          {t('admin.product.pageInfo', {
            page: String(page),
            pages: String(Math.max(1, Math.ceil(total / 25))),
            total: String(total),
          })}
        </span>
        <button
          type="button"
          disabled={page * 25 >= total}
          onClick={() => {
            const next = new URLSearchParams(searchParams.toString());
            next.set('page', String(page + 1));
            router.replace(`${pathname}?${next.toString()}`);
          }}
        >
          {t('admin.common.next')}
        </button>
      </div>

      {createOpen && (
        <form
          data-testid="admin-product-create-form"
          onSubmit={onCreate}
          style={{
            marginTop: '1rem',
            border: '1px solid #ccc',
            padding: '1rem',
            display: 'grid',
            gap: '0.5rem',
            maxWidth: 480,
          }}
        >
          <h2>{t('admin.product.createFormTitle')}</h2>
          <label>
            {t('admin.product.canonicalName')}
            <input
              required
              data-testid="admin-product-create-name"
              value={form.canonicalName}
              onChange={(e) => setForm({ ...form, canonicalName: e.target.value })}
            />
          </label>
          <label>
            {t('admin.product.productKey')}
            <input
              required
              data-testid="admin-product-create-key"
              value={form.productKey}
              onChange={(e) => setForm({ ...form, productKey: e.target.value })}
            />
          </label>
          <label>
            {t('admin.product.category')}
            <select
              required
              data-testid="admin-product-create-category"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">{t('admin.product.selectCategory')}</option>
              {meta?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('admin.product.form')}
            <select value={form.form} onChange={(e) => setForm({ ...form, form: e.target.value })}>
              {meta?.forms.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('admin.product.defaultUnit')}
            <select value={form.defaultUnit} onChange={(e) => setForm({ ...form, defaultUnit: e.target.value })}>
              {meta?.units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          {createError && <p role="alert">{createError}</p>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" data-testid="admin-product-create-submit">
              {t('admin.common.save')}
            </button>
            <button type="button" onClick={() => setCreateOpen(false)}>
              {t('admin.common.cancel')}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
