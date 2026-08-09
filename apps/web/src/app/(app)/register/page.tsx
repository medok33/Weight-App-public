import { Suspense } from 'react';
import { AuthScreen } from '@/features/auth/components/auth-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function RegisterPage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback />}>
      <AuthScreen mode="register" />
    </Suspense>
  );
}
