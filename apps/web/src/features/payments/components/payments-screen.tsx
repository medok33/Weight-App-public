'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getOffers, getPayment, startCheckout } from '../api/payments.client';
import type { PaymentView, ProductOffer } from '../model/payments.types';
import Link from 'next/link';
import { useI18n } from '@/i18n/locale-provider';
import type { MessageKey } from '@/i18n/types';

type UiState = 'loading' | 'empty' | 'error' | 'forbidden' | 'success';

export function PaymentsScreen() {
  const params = useSearchParams();
  const { t } = useI18n();
  const checkoutId = params.get('checkout');
  const forced = params.get('status');
  const [state, setState] = useState<UiState>('loading');
  const [offers, setOffers] = useState<ProductOffer[]>([]);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (forced === 'success' || forced === 'failure') {
          if (cancelled) return;
          setState('success');
          return;
        }
        if (checkoutId) {
          const view = await getPayment(checkoutId);
          if (cancelled) return;
          setPayment(view);
          setState('success');
          return;
        }
        const list = await getOffers();
        if (cancelled) return;
        setOffers(list);
        setState(list.length ? 'success' : 'empty');
      } catch (error) {
        if (cancelled) return;
        setState(error instanceof Error && error.message === 'PAYMENT_FORBIDDEN' ? 'forbidden' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkoutId, forced]);

  const outcome = useMemo(() => {
    if (forced === 'success' || forced === 'failure') return forced;
    return payment?.outcome ?? null;
  }, [forced, payment]);

  async function onCheckout(offerKey: string) {
    setBusyKey(offerKey);
    try {
      const returnUrl = `${window.location.origin}/payments`;
      const session = await startCheckout(offerKey, returnUrl, `web-${offerKey}-${Date.now()}`);
      window.location.assign(session.confirmationUrl);
    } catch {
      setState('error');
      setBusyKey(null);
    }
  }

  if (state === 'loading') {
    return (
      <main aria-busy="true" data-testid="payments-loading">
        <h1>{t('payments.title')}</h1>
        <p>{t('payments.loading')}</p>
      </main>
    );
  }
  if (state === 'forbidden') {
    return (
      <main role="alert" data-testid="payments-forbidden">
        <h1>{t('payments.title')}</h1>
        <p>{t('payments.signIn')}</p>
      </main>
    );
  }
  if (state === 'error') {
    return (
      <main role="alert" data-testid="payments-error">
        <h1>{t('payments.title')}</h1>
        <p>{t('payments.unavailable')}</p>
      </main>
    );
  }
  if (state === 'empty') {
    return (
      <main data-testid="payments-empty">
        <h1>{t('payments.title')}</h1>
        <p>{t('payments.plansEmpty')}</p>
      </main>
    );
  }

  if (checkoutId || outcome) {
    const label =
      outcome === 'success'
        ? t('payments.succeeded')
        : outcome === 'failure'
          ? t('payments.failed')
          : t('payments.pending');
    return (
      <main data-testid="payments-result">
        <h1>{t('payments.title')}</h1>
        <p>{t('payments.placeholder')}</p>
        <p data-testid={`payments-outcome-${outcome ?? 'pending'}`}>{label}</p>
        {payment ? (
          <p data-testid="payments-amount">
            {(payment.amountMinor / 100).toFixed(2)} {payment.currency}
          </p>
        ) : null}
        <p>
          <Link href="/pricing">{t('payments.backToPlans')}</Link>
        </p>
      </main>
    );
  }

  return (
    <main data-testid="payments-offers">
      <h1>{t('payments.title')}</h1>
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
            <button
              type="button"
              data-testid={`payments-checkout-${offer.key}`}
              disabled={busyKey === offer.key}
              onClick={() => onCheckout(offer.key)}
            >
              {busyKey === offer.key ? t('payments.starting') : t('payments.checkout')}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
