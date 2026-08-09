'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listProductDuplicates, type AdminDuplicateItem } from '../api/product-admin.client';

export function ProductDuplicatesScreen() {
  const [items, setItems] = useState<AdminDuplicateItem[]>([]);
  const [state, setState] = useState<'loading' | 'error' | 'forbidden' | 'success'>('loading');

  useEffect(() => {
    listProductDuplicates()
      .then((res) => {
        setItems(res.items);
        setState('success');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        setState(message.includes('FORBIDDEN') || message.includes('MFA') ? 'forbidden' : 'error');
      });
  }, []);

  if (state === 'forbidden') {
    return (
      <main role="alert">
        Нет прав для просмотра раздела
      </main>
    );
  }

  return (
    <main data-testid="admin-product-duplicates" style={{ padding: '1rem', maxWidth: 960, margin: '0 auto' }}>
      <p>
        <Link href="/admin/products">← Продукты</Link>
      </p>
      <h1>Возможные дубликаты продуктов</h1>
      <p>Только детерминированные сигналы. Автообъединение отключено.</p>
      {state === 'loading' && <p>Загрузка…</p>}
      {state === 'error' && <p role="alert">Не удалось загрузить список</p>}
      <ul data-testid="admin-duplicates-list">
        {items.map((item) => (
          <li key={`${item.pair[0]?.id}-${item.pair[1]?.id}`}>
            <Link href={`/admin/products/${item.pair[0]?.id}`}>{item.pair[0]?.canonicalName}</Link>
            {' ↔ '}
            <Link href={`/admin/products/${item.pair[1]?.id}`}>{item.pair[1]?.canonicalName}</Link>
            {' · '}
            {item.reasons.join(', ')} · уверенность {item.confidence}
          </li>
        ))}
      </ul>
      {state === 'success' && items.length === 0 && <p>Пар не найдено</p>}
    </main>
  );
}
