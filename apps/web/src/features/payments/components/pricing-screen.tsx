'use client';

import { useEffect, useState } from 'react';
import { getOffers } from '../api/payments.client';
import type { ProductOffer } from '../model/payments.types';
import { useI18n } from '@/i18n/locale-provider';
import type { MessageKey } from '@/i18n/types';

export function PricingScreen() {
  const { t } = useI18n();
  const [state, setState] = useState<'loading' | 'empty' | 'error' | 'success'>('loading');
  const [offers, setOffers] = useState<ProductOffer[]>([]);

  useEffect(() => {
    getOffers()
      .then((result) => {
        setOffers(result);
        setState(result.length ? 'success' : 'empty');
      })
      .catch(() => setState('error'));
  }, []);

  if (state === 'loading') {
    return <main aria-busy="true"><h1>{t('payments.plansTitle')}</h1><p>{t('payments.plansLoading')}</p></main>;
  }
  if (state === 'error') {
    return <main role="alert"><h1>{t('payments.plansTitle')}</h1><p>{t('payments.plansUnavailable')}</p></main>;
  }
  if (state === 'empty') {
    return <main><h1>{t('payments.plansTitle')}</h1><p>{t('payments.plansEmpty')}</p></main>;
  }
  return (
    <main>
      <h1>{t('payments.plansTitle')}</h1>
      <p>{t('payments.placeholder')}</p>
      <ul>
        {offers.map((offer) => (
          <li key={offer.key}>
            <h2>{offer.name}</h2>
            <p>
              {(offer.amountMinor / 100).toFixed(2)} {offer.currency} ·{' '}
              {t('payments.interval', {
                interval: t(`payments.interval.${offer.interval}` as MessageKey),
              })}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
