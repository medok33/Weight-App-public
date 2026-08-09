import { ProductAdminDetailScreen } from '@/features/product-admin/components/product-admin-detail-screen';

export default async function AdminProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductAdminDetailScreen productId={id} />;
}
