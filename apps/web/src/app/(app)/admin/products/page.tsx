import { Suspense } from 'react';
import { ProductAdminListScreen } from '@/features/product-admin/components/product-admin-list-screen';
import { LocalizedLoadingFallback } from '@/components/localized-loading-fallback';

export default function AdminProductsPage() {
  return (
    <Suspense fallback={<LocalizedLoadingFallback />}>
      <ProductAdminListScreen />
    </Suspense>
  );
}
