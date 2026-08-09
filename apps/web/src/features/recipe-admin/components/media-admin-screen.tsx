'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../../../i18n/locale-provider';
import { labelMediaRights } from '../../../i18n/enums';

type MediaRow = {
  id: string;
  sourceType: string;
  licenseType: string;
  rightsStatus: string;
  moderationStatus: string;
  attributionText: string | null;
  originalFilename: string | null;
};

export function MediaAdminScreen() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'forbidden' | 'error' | 'success'>('loading');
  const [storageConfigured, setStorageConfigured] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));

  async function reload() {
    const response = await fetch('/api/admin/media', { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
      setState('forbidden');
      return;
    }
    if (!response.ok) {
      setState('error');
      return;
    }
    const data = (await response.json()) as { items: MediaRow[]; storageConfigured?: boolean };
    const list = data.items ?? [];
    setItems(list);
    setStorageConfigured(data.storageConfigured !== false);
    const wanted = searchParams.get('selected');
    if (wanted && list.some((item) => item.id === wanted)) setSelectedId(wanted);
    setState('success');
  }

  useEffect(() => {
    void reload();
  }, [searchParams.toString()]);

  async function register() {
    const response = await fetch('/api/admin/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'OWNED_UPLOAD',
        licenseType: 'ALL_RIGHTS_OWNED',
        mimeType: 'image/jpeg',
        originalFilename: 'dish.jpg',
        attributionText: 'Owner upload',
      }),
    });
    setMessage(response.ok ? t('admin.media.registered') : await response.text());
    await reload();
  }

  async function approve(id: string) {
    const rights = await fetch(`/api/admin/media/${id}/rights`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rightsStatus: 'APPROVED',
        licenseType: 'ALL_RIGHTS_OWNED',
        attributionText: 'Owner upload',
      }),
    });
    if (!rights.ok) {
      setMessage(await rights.text());
      return;
    }
    const mod = await fetch(`/api/admin/media/${id}/moderation`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ moderationStatus: 'APPROVED' }),
    });
    setMessage(mod.ok ? t('admin.media.approved') : await mod.text());
    await reload();
  }

  async function takedown(id: string) {
    const response = await fetch(`/api/admin/media/${id}/takedown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'OWNER_TAKEDOWN' }),
    });
    setMessage(response.ok ? t('admin.media.takedownDone') : await response.text());
    await reload();
  }

  if (state === 'loading') return <main aria-busy="true">{t('admin.media.loading')}</main>;
  if (state === 'forbidden') return <main data-testid="admin-media-forbidden">{t('admin.media.forbidden')}</main>;
  if (state === 'error') return <main role="alert">{t('admin.media.unavailable')}</main>;

  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <main data-testid="admin-media" style={{ padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <p>
        <Link href="/admin/recipes">{t('admin.common.backToRecipes')}</Link>
      </p>
      <h1>{t('admin.media.title')}</h1>
      {!storageConfigured ? (
        <p data-testid="media-storage-not-configured">{t('admin.media.storageNotConfigured')}</p>
      ) : null}
      <button type="button" data-testid="media-register" onClick={() => void register()}>
        {t('admin.media.register')}
      </button>
      {message ? <p role="status">{message}</p> : null}
      <ul data-testid="media-list" style={{ listStyle: 'none', padding: 0 }}>
        {items.map((item) => (
          <li
            key={item.id}
            data-testid={`media-row-${item.id}`}
            data-selected={item.id === selectedId ? 'true' : 'false'}
            style={{
              borderBottom: '1px solid #ddd',
              padding: '0.75rem 0',
              background: item.id === selectedId ? '#eef6ff' : undefined,
            }}
          >
            <button type="button" onClick={() => setSelectedId(item.id)}>
              {item.originalFilename ?? 'Медиафайл'} · {labelMediaRights(item.rightsStatus)} ·{' '}
              {t('admin.media.moderation')}: {labelMediaRights(item.moderationStatus)}
            </button>
            <button type="button" data-testid={`media-approve-${item.id}`} onClick={() => void approve(item.id)}>
              {t('admin.media.approve')}
            </button>{' '}
            <button type="button" data-testid={`media-takedown-${item.id}`} onClick={() => void takedown(item.id)}>
              {t('admin.media.takedown')}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <section data-testid="media-selected-detail" style={{ marginTop: 16 }}>
          <h2>{t('admin.media.selected')}</h2>
          <p>
            {labelMediaRights(selected.rightsStatus)} · {t('admin.media.moderation')}:{' '}
            {labelMediaRights(selected.moderationStatus)}
          </p>
          {selected.rightsStatus === 'TAKEDOWN' ? (
            <p data-testid="media-takedown-state">{t('admin.media.takedownActive')}</p>
          ) : null}
          <details>
            <summary>{t('admin.common.technicalDetails')}</summary>
            <p>
              {selected.id} · {selected.sourceType} · {selected.licenseType}
            </p>
          </details>
        </section>
      ) : null}
    </main>
  );
}
