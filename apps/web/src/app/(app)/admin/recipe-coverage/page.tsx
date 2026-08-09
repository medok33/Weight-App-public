import { Suspense } from 'react';
import { RecipeCoverageBoardScreen } from '@/features/recipe-admin/components/recipe-coverage-board-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function RecipeCoveragePage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback />}>
      <RecipeCoverageBoardScreen />
    </Suspense>
  );
}
