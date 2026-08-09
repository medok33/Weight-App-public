'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  listProductReview,
  postProductReview,
  type AdminReviewItem,
} from '../api/product-admin.client';

const QUEUE_LABELS: Record<string, string> = {
  UNCLASSIFIED: 'Без классификации',
  MISSING_NUTRITION: 'Нет КБЖУ',
  UNVERSIONED_LEGACY: 'Устаревшая версия без версионирования',
  AMBIGUOUS_ALIAS: 'Неоднозначный псевдоним',
  HEURISTIC_ALLERGEN: 'Эвристический аллерген',
  MISSING_CULINARY_ROLE: 'Нет кулинарной роли',
  RETAIL_NEEDS_PRODUCT_MAPPING: 'Нужно сопоставление ритейла',
  LEGACY_PRICE_ONLY: 'Только устаревшая цена',
  POSSIBLE_DUPLICATE: 'Возможный дубликат',
  MANUAL: 'Ручная проверка',
};

const SEVERITY_LABELS: Record<string, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
};

export function ProductReviewScreen() {
  const [items, setItems] = useState<AdminReviewItem[]>([]);
  const [queue, setQueue] = useState('');
  const [datasetVersion, setDatasetVersion] = useState('');
  const [severity, setSeverity] = useState('');
  const [source, setSource] = useState('');
  const [state, setState] = useState<'loading' | 'error' | 'forbidden' | 'success'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setState('loading');
    listProductReview({
      queue: queue || undefined,
      datasetVersion: datasetVersion || undefined,
      severity: severity || undefined,
      source: source || undefined,
    })
      .then((res) => {
        setItems(res.items);
        setState('success');
      })
      .catch((error: unknown) => {
        const errMessage = error instanceof Error ? error.message : '';
        setState(errMessage.includes('FORBIDDEN') || errMessage.includes('MFA') ? 'forbidden' : 'error');
      });
  }, [queue, datasetVersion, severity, source]);

  async function resolveNonBlocking(item: AdminReviewItem) {
    setMessage(null);
    try {
      await postProductReview(item.productId, {
        queueCode: item.queueCode,
        decision: 'RESOLVED',
        note: 'Неблокирующая проверка принята в админ-панели',
      });
      setMessage(`Решено: ${item.canonicalName}`);
      setItems((prev) => prev.filter((x) => !(x.productId === item.productId && x.queueCode === item.queueCode)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось закрыть проверку');
    }
  }

  if (state === 'forbidden') {
    return (
      <main role="alert">
        Нет прав для просмотра раздела
      </main>
    );
  }

  return (
    <main data-testid="admin-product-review" style={{ padding: '1rem', maxWidth: 960, margin: '0 auto' }}>
      <p>
        <Link href="/admin/products">← Продукты</Link>
      </p>
      <h1>Очереди проверки продуктов</h1>
      <section style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
        <label>
          Очередь
          <select data-testid="admin-review-queue" value={queue} onChange={(e) => setQueue(e.target.value)}>
            <option value="">Все рассчитанные</option>
            {Object.entries(QUEUE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Версия набора
          <select
            data-testid="admin-review-dataset"
            value={datasetVersion}
            onChange={(e) => setDatasetVersion(e.target.value)}
          >
            <option value="">Любая</option>
            <option value="pilot-v1">pilot-v1</option>
            <option value="catalog-core-v2">catalog-core-v2</option>
            <option value="catalog-core-v3">catalog-core-v3</option>
          </select>
        </label>
        <label>
          Важность
          <select
            data-testid="admin-review-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">Любая</option>
            {Object.entries(SEVERITY_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Источник
          <input
            data-testid="admin-review-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="SEED / CATEGORY / …"
          />
        </label>
      </section>
      {message && <p role="status">{message}</p>}
      {state === 'loading' && <p>Загрузка…</p>}
      {state === 'error' && <p role="alert">Не удалось загрузить очередь</p>}
      <ul data-testid="admin-review-list">
        {items.map((item, index) => (
          <li key={`${item.queueCode}-${item.productId}-${index}`}>
            <strong>{QUEUE_LABELS[item.queueCode] ?? item.queueCode}</strong>{' '}
            [{SEVERITY_LABELS[item.severity] ?? item.severity}]{' '}
            <Link href={`/admin/products/${item.productId}`}>{item.canonicalName}</Link> · {item.source}{' '}
            <button
              type="button"
              data-testid={`admin-review-resolve-${item.productId}`}
              onClick={() => void resolveNonBlocking(item)}
            >
              Закрыть
            </button>
          </li>
        ))}
      </ul>
      {state === 'success' && items.length === 0 && <p>Очередь пуста</p>}
    </main>
  );
}
