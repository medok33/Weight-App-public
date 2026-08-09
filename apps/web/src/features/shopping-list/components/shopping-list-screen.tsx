'use client';

import { useEffect, useState } from 'react';
import { generateShoppingList, getShoppingList, setShoppingItemPurchased } from '../api/shopping-list.client';
import type { ShoppingList } from '../model/shopping-list.types';
import { useI18n } from '../../../i18n/locale-provider';
import type { MessageKey } from '../../../i18n/types';

export function ShoppingListScreen() {
  const { t, tc } = useI18n();
  const [state, setState] = useState<{
    status: 'loading' | 'empty' | 'ready' | 'generating' | 'error';
    list?: ShoppingList;
    message?: string;
  }>({ status: 'loading' });

  async function load() {
    try {
      const list = await getShoppingList();
      setState({ status: 'ready', list });
    } catch {
      setState({ status: 'empty' });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onGenerate() {
    setState((current) => ({ ...current, status: 'generating' }));
    try {
      const list = await generateShoppingList();
      setState({ status: 'ready', list, message: t('shopping.generated') });
    } catch {
      setState({ status: 'error', message: t('shopping.generateError') });
    }
  }

  async function onToggle(itemId: string, purchased: boolean) {
    if (!state.list) return;
    const optimistic: ShoppingList = {
      ...state.list,
      items: state.list.items.map((item) => (item.id === itemId ? { ...item, purchased: !purchased } : item)),
    };
    setState({ status: 'ready', list: optimistic });
    try {
      const list = await setShoppingItemPurchased(itemId, !purchased);
      setState({ status: 'ready', list });
    } catch {
      setState({ status: 'error', list: state.list, message: t('shopping.purchaseError') });
    }
  }

  if (state.status === 'loading') {
    return (
      <main aria-busy="true">
        <h1>{t('shopping.title')}</h1>
        <p role="status" aria-live="polite">
          {t('common.loading')}
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1 data-testid="shopping-heading">{t('shopping.title')}</h1>
      <p>{t('shopping.subtitle')}</p>
      {state.message ? <p role="status" data-testid="shopping-status">{state.message}</p> : null}
      <button type="button" data-testid="shopping-generate" onClick={onGenerate} disabled={state.status === 'generating'}>
        {state.status === 'generating' ? t('shopping.generating') : t('shopping.generate')}
      </button>
      {state.status === 'empty' || !state.list ? (
        <p data-testid="shopping-empty">{t('shopping.empty')}</p>
      ) : (
        <>
          <p data-testid="shopping-plan-version">
            {t('shopping.planVersion', { version: state.list.sourcePlanVersion ?? '—' })} ·{' '}
            {t(`shopping.sync.${state.list.syncStatus ?? 'unknown'}` as MessageKey)}
          </p>
          <p data-testid="shopping-total">
            {t('shopping.basket')}: {state.list.estimatedTotal} {t('unit.currency')} · {t('shopping.purchased')} {state.list.purchasedTotal} · {t('shopping.remaining')} {state.list.remainingTotal}
          </p>
          <ul data-testid="shopping-items">
            {state.list.items.map((item) => (
              <li key={item.id} data-testid={`shopping-item-${item.id}`}>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`shopping-purchase-${item.id}`}
                    checked={item.purchased}
                    onChange={() => onToggle(item.id, item.purchased)}
                  />
                  {' '}
                  {/*
                    Product names come from the catalog/DB (unbounded). Prefer content
                    dictionary when a stable key/alias exists; otherwise show API name.
                    Never build hard-required i18n keys from product display names.
                  */}
                  <span data-testid={`shopping-item-name-${item.id}`}>{tc('product', item.name)}</span>
                  {' · '}
                  <span data-testid={`shopping-item-qty-${item.id}`}>
                    {item.quantity} {item.unit}
                  </span>
                  {' · '}
                  <span data-testid={`shopping-item-price-${item.id}`}>
                    {item.estimatedUnitPrice} {t('unit.currency')}
                  </span>
                  {item.purchased ? ' ✓' : ''}
                </label>
                {item.retailerName ? (
                  <p data-testid={`shopping-item-store-${item.id}`}>
                    {t('shopping.store')}: {item.retailerName}
                  </p>
                ) : null}
                {item.priceSourceName ? (
                  <p data-testid={`shopping-item-source-${item.id}`}>
                    {t('shopping.priceSource')}: {item.priceSourceName}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
