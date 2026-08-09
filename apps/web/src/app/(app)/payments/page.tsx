import { Suspense } from 'react';
import { PaymentsScreen } from '@/features/payments/components/payments-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function PaymentsPage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback titleKey="payments.title" />}>
      <PaymentsScreen />
    </Suspense>
  );
}
