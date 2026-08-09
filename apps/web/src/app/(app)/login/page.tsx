import { Suspense } from 'react';
import { AuthScreen } from '@/features/auth/components/auth-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function LoginPage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback />}>
      <AuthScreen mode="login" />
    </Suspense>
  );
}
