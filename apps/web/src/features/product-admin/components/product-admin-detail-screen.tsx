'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/locale-provider';
import {
  addAdminAlias,
  createNutritionVersion,
  getAdminProduct,
  getAdminProductMeta,
  mergePreview,
  mergeProducts,
  putAdminCulinaryRoles,
  updateAdminProduct,
  type AdminProductDetail,
  type AdminProductMeta,
} from '../api/product-admin.client';

export function ProductAdminDetailScreen({ productId }: { productId: string }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<AdminProductDetail | null>(null);
  const [meta, setMeta] = useState<AdminProductMeta | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'forbidden' | 'success'>('loading');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [form, setForm] = useState('');
  const [alias, setAlias] = useState('');
  const [nutrition, setNutrition] = useState({
    calories: 0,
    protein: 0,
    fat: 0,
    carbohydrate: 0,
    source: 'MANUAL',
  });
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeInfo, setMergeInfo] = useState<Record<string, unknown> | null>(null);

  async function reload() {
    setState('loading');
    try {
      const [d, m] = await Promise.all([getAdminProduct(productId), getAdminProductMeta()]);
      setDetail(d);
      setMeta(m);
      setName(String(d.overview.canonicalName ?? ''));
      setCategoryId(String(d.overview.categoryId ?? ''));
      setForm(String(d.overview.form ?? ''));
      setDirty(false);
      setState('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setState(
        message === 'OWNER_ACCESS_FORBIDDEN' || message === 'MFA_REQUIRED' ? 'forbidden' : 'error',
      );
    }
  }

  useEffect(() => {
    void reload();
  }, [productId]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (state === 'loading') return <main aria-busy="true">{t('admin.product.detail.loading')}</main>;
  if (state === 'forbidden') return <main data-testid="admin-product-forbidden">{t('admin.product.detail.forbidden')}</main>;
  if (state === 'error' || !detail) return <main role="alert">{t('admin.product.detail.unavailable')}</main>;

  const overview = detail.overview;

  return (
    <main data-testid="admin-product-detail" style={{ padding: '1rem', maxWidth: 960, margin: '0 auto' }}>
      <p>
        <Link href="/admin/products">{t('admin.common.backToProducts')}</Link>
      </p>
      <h1 data-testid="admin-product-title">{String(overview.canonicalName)}</h1>
      <p data-testid="admin-product-dataset">
        Набор данных: {overview.seedDatasetVersion ? String(overview.seedDatasetVersion) : '—'}
      </p>
      {overview.reviewWarnings?.length ? (
        <ul data-testid="admin-product-warnings">
          {overview.reviewWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {message && <p role="status">{message}</p>}

      <section data-testid="admin-product-overview" style={{ border: '1px solid #ddd', padding: '0.75rem', marginTop: '1rem' }}>
        <h2>Обзор · категория и форма</h2>
        <label>
          Каноническое название
          <input
            data-testid="admin-product-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label>
          Категория
          <select
            data-testid="admin-product-category"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setDirty(true);
            }}
          >
            {meta?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Форма
          <select
            data-testid="admin-product-form"
            value={form}
            onChange={(e) => {
              setForm(e.target.value);
              setDirty(true);
            }}
          >
            {meta?.forms.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="admin-product-save"
          onClick={async () => {
            try {
              const updated = await updateAdminProduct(productId, {
                canonicalName: name,
                categoryId,
                form,
                rowVersion: overview.rowVersion,
              });
              setDetail(updated);
              setDirty(false);
              setMessage('Изменения сохранены');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Не удалось сохранить изменения');
            }
          }}
        >
          Сохранить изменения
        </button>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Версии КБЖУ</h2>
        <p data-testid="admin-nutrition-current">
          Текущая версия: {String(overview.currentNutritionVersion ?? 'нет')}
        </p>
        <ul data-testid="admin-nutrition-list">
          {detail.nutritionVersions.map((v) => (
            <li key={String(v.id)}>
              v{String(v.version)} — {String(v.calories)} ккал / Б{String(v.protein)} Ж{String(v.fat)} У
              {String(v.carbohydrate)} (неизменяемая)
            </li>
          ))}
        </ul>
        <form
          data-testid="admin-nutrition-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await createNutritionVersion(productId, nutrition);
              setMessage('Версия КБЖУ создана; связанные рецепты потребуют повторной проверки.');
              await reload();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Не удалось создать версию КБЖУ');
            }
          }}
          style={{ display: 'grid', gap: '0.35rem', maxWidth: 360 }}
        >
          {(
            [
              ['calories', 'Калории'],
              ['protein', 'Белки'],
              ['fat', 'Жиры'],
              ['carbohydrate', 'Углеводы'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                step="0.1"
                required
                value={nutrition[key]}
                onChange={(e) => setNutrition({ ...nutrition, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <button type="submit" data-testid="admin-nutrition-submit">
            Создать версию
          </button>
        </form>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Псевдонимы</h2>
        <ul data-testid="admin-alias-list">
          {detail.aliases.map((a) => (
            <li key={String(a.id)}>
              {String(a.alias)} → {String(a.normalizedAlias)} [{String(a.status)}]
            </li>
          ))}
        </ul>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const result = (await addAdminAlias(productId, { alias })) as {
                status?: string;
                normalizedAlias?: string;
              };
              setMessage(`Псевдоним: ${result.status} (${result.normalizedAlias})`);
              setAlias('');
              await reload();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Не удалось добавить псевдоним');
            }
          }}
        >
          <input
            data-testid="admin-alias-input"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="Новый псевдоним"
          />
          <button type="submit" data-testid="admin-alias-submit">
            Добавить псевдоним
          </button>
        </form>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Аллергены / питание / роли</h2>
        <p data-testid="admin-allergens">
          Аллергены:{' '}
          {detail.allergens.length
            ? detail.allergens.map((a) => `${a.code}:${a.presence}:${a.source}`).join(', ')
            : 'неизвестно (отсутствие не подтверждено)'}
        </p>
        <p data-testid="admin-dietary">
          Питание: {detail.dietaryTags.map((tag) => `${tag.code}:${tag.source}`).join(', ') || 'нет'}
        </p>
        <p data-testid="admin-roles">
          Роли:{' '}
          {detail.culinaryRoles.map((r) => `${r.code}${r.isPrimary ? '*' : ''}`).join(', ') || 'нет'}
        </p>
        <button
          type="button"
          data-testid="admin-roles-set-starch"
          onClick={async () => {
            const starch = meta?.culinaryRoles.find((r) => r.code === 'STARCH');
            if (!starch) return;
            await putAdminCulinaryRoles(productId, [
              { culinaryRoleId: starch.id, isPrimary: true, source: 'OWNER_REVIEWED' },
            ]);
            await reload();
          }}
        >
          Назначить основную роль «крахмал» (если доступна)
        </button>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Замены</h2>
        <ul data-testid="admin-substitutions">
          {detail.substitutions.map((s) => (
            <li key={String(s.id)}>
              {String(s.sourceName)} → {String(s.replacementName)} [{String(s.status)}] · методы:{' '}
              {Array.isArray(s.supportedMethods) ? (s.supportedMethods as string[]).join('|') : '—'}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Ритейл / цены</h2>
        <ul data-testid="admin-retail">
          {detail.retailProducts.map((r) => (
            <li key={String(r.id)}>
              {String(r.retailerName)} / {String(r.title)} / {String(r.mappingStatus)} / уп.{' '}
              {String(r.packageWeight)}
              {String(r.packageUnit ?? '')}
            </li>
          ))}
        </ul>
        <ul data-testid="admin-prices">
          {detail.prices.map((p) => (
            <li key={String(p.id)}>
              {String(p.price)} {String(p.currency)} · {String(p.provenance)} · {String(p.retailerName)}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Зависимости / аудит</h2>
        <p data-testid="admin-recipe-deps">Зависимости рецептов: {String(overview.recipeDependencyCount)}</p>
        <p data-testid="admin-revalidation">
          Потребуется повторная проверка рецептов:{' '}
          {detail.futureRecipeRevalidationRequired ? 'да' : 'нет'}
        </p>
        <ul data-testid="admin-audit">
          {detail.auditHistory.map((a) => (
            <li key={String(a.id)}>
              {String(a.createdAt)} · {String(a.action)}
            </li>
          ))}
        </ul>
      </section>

      <section
        style={{ marginTop: '1rem', border: '1px solid #c44', padding: '0.75rem' }}
        data-testid="admin-merge-section"
      >
        <h2>Объединение (опасное действие)</h2>
        <p>Источник — текущий продукт. Укажите UUID целевого продукта.</p>
        <input
          data-testid="admin-merge-target"
          value={mergeTarget}
          onChange={(e) => setMergeTarget(e.target.value)}
          placeholder="UUID целевого продукта"
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            data-testid="admin-merge-preview"
            onClick={async () => {
              try {
                const preview = (await mergePreview(productId, mergeTarget)) as Record<string, unknown>;
                setMergeInfo(preview);
                setMessage(
                  preview.blocked
                    ? `Объединение заблокировано: ${String(preview.blockReason)}`
                    : 'Предпросмотр готов',
                );
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'Не удалось выполнить предпросмотр');
              }
            }}
          >
            Предпросмотр
          </button>
          <button
            type="button"
            data-testid="admin-merge-confirm"
            style={{ background: '#c44', color: '#fff' }}
            onClick={async () => {
              if (!window.confirm('Подтвердить объединение? Источник будет помечен как объединённый.')) return;
              try {
                const result = (await mergeProducts(productId, mergeTarget)) as {
                  status: string;
                  reason?: string;
                };
                setMessage(
                  result.status === 'MERGED'
                    ? 'Продукты объединены'
                    : `Объединение заблокировано: ${result.reason ?? result.status}`,
                );
                await reload();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'Не удалось объединить продукты');
              }
            }}
          >
            Подтвердить объединение
          </button>
        </div>
        {mergeInfo && (
          <details>
            <summary>{t('admin.common.technicalDetails')}</summary>
            <pre data-testid="admin-merge-preview-json" style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(mergeInfo, null, 2)}
            </pre>
          </details>
        )}
      </section>
      <details style={{ marginTop: '1rem' }}>
        <summary>{t('admin.common.technicalDetails')}</summary>
        <p data-testid="admin-product-id">UUID: {overview.id}</p>
      </details>
    </main>
  );
}
