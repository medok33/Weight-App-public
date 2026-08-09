import { Suspense } from 'react';
import { MediaAdminScreen } from '@/features/recipe-admin/components/media-admin-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function AdminMediaPage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback />}>
      <MediaAdminScreen />
    </Suspense>
  );
}
