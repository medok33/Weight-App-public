import { Suspense } from 'react';
import { RecipeRevalidationScreen } from '@/features/recipe-admin/components/recipe-revalidation-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function AdminRecipeRevalidationPage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback />}>
      <RecipeRevalidationScreen />
    </Suspense>
  );
}
