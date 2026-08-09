'use client';

import { useEffect, useState } from 'react';
import { getPantryInventory, upsertPantryItem } from '../api/pantry.client';
import type { PantryInventory, PantryScreenState } from '../model/pantry.types';
import { useI18n } from '@/i18n/locale-provider';
import type { MessageKey } from '@/i18n/types';

function expiryKey(status: string): MessageKey {
  switch (status) {
    case 'ok':
      return 'pantry.expiry.ok';
    case 'soon':
      return 'pantry.expiry.soon';
    case 'expired':
      return 'pantry.expiry.expired';
    default:
      return 'pantry.expiry.unknown';
  }
}

function unitKey(unit: string): MessageKey | null {
  return ['pcs', 'g', 'ml', 'kg', 'l'].includes(unit) ? (`pantry.unit.${unit}` as MessageKey) : null;
}

export function PantryScreen() {
  const { t, tc } = useI18n();
  const [state, setState] = useState<PantryScreenState>('loading');
  const [inventory, setInventory] = useState<PantryInventory | null>(null);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('pcs');
  const [expiresOn, setExpiresOn] = useState('');
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    getPantryInventory()
      .then((data) => {
        setInventory(data);
        setState(data.items.length ? 'success' : 'empty');
      })
      .catch((error: unknown) => {
        const code = error instanceof Error ? error.message : '';
        setState(code === 'PANTRY_FORBIDDEN' ? 'forbidden' : 'error');
      });
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    try {
      const result = await upsertPantryItem({
        name,
        quantity: Number(quantity),
        unit,
        expiresOn: expiresOn || null,
      });
      setInventory((current) =>
        current
          ? { ...current, items: result.items }
          : { pantry: { id: 'local', name: t('pantry.home') }, items: result.items },
      );
      setState(result.items.length ? 'success' : 'empty');
      setName('');
      setQuantity('1');
      setExpiresOn('');
      setMessage(t('pantry.saved'));
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'PANTRY_FORBIDDEN') setState('forbidden');
      else setMessage(t('pantry.saveError'));
    }
  }

  if (state === 'loading') {
    return (
      <main aria-busy="true" data-testid="pantry-screen">
        <h1>{t('pantry.title')}</h1>
        <p>{t('common.loading')}</p>
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main role="alert" data-testid="pantry-screen">
        <h1>{t('pantry.title')}</h1>
        <p>{t('ui.forbiddenTitle')}</p>
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main role="alert" data-testid="pantry-screen">
        <h1>{t('pantry.title')}</h1>
        <p>{t('pantry.loadError')}</p>
      </main>
    );
  }

  return (
    <main data-testid="pantry-screen">
      <h1 data-testid="pantry-heading">{t('pantry.title')}</h1>
      <p>{t('pantry.subtitle')}</p>
      <form onSubmit={onSubmit} data-testid="pantry-form">
        <label>
          {t('pantry.name')}
          <input data-testid="pantry-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t('pantry.quantity')}
          <input
            data-testid="pantry-quantity"
            type="number"
            min="0.001"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </label>
        <label>
          {t('pantry.unit')}
          <select data-testid="pantry-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {['pcs', 'g', 'ml', 'kg', 'l'].map((value) => (
              <option key={value} value={value}>{t(`pantry.unit.${value}` as MessageKey)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('pantry.expiresOn')}
          <input
            data-testid="pantry-expires"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </label>
        <button type="submit" data-testid="pantry-save">
          {t('common.save')}
        </button>
      </form>
      {message ? <p data-testid="pantry-message">{message}</p> : null}
      {state === 'empty' ? <p data-testid="pantry-empty">{t('pantry.empty')}</p> : null}
      {inventory && inventory.items.length > 0 ? (
        <ul data-testid="pantry-list">
          {inventory.items.map((item) => (
            <li key={item.id} data-testid={`pantry-item-${item.id}`} data-expiry={item.expiryStatus}>
              {tc('product', item.name)} — {item.quantity} {unitKey(item.unit) ? t(unitKey(item.unit)!) : item.unit}
              {item.expiresOn
                ? ` (${t('pantry.until')} ${item.expiresOn}, ${t(expiryKey(item.expiryStatus))})`
                : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
