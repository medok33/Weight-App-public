import { Suspense } from 'react';
import { RecipeAdminListScreen } from '@/features/recipe-admin/components/recipe-admin-list-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function AdminRecipesPage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback />}>
      <RecipeAdminListScreen />
    </Suspense>
  );
}
