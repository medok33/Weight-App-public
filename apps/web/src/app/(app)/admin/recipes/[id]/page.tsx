import { RecipeAdminDetailScreen } from '@/features/recipe-admin/components/recipe-admin-detail-screen';

export default async function AdminRecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RecipeAdminDetailScreen recipeId={id} />;
}
