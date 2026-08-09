import { Suspense } from 'react';
import { RecipeDuplicatesScreen } from '@/features/recipe-admin/components/recipe-duplicates-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function AdminRecipeDuplicatesPage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback />}>
      <RecipeDuplicatesScreen />
    </Suspense>
  );
}
