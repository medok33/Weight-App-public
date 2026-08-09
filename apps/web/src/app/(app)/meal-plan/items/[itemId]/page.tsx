import { RequireAuth } from '@/features/auth/components/require-auth';
import { MealDishDetailScreen } from '@/features/meal-plan/components/meal-dish-detail-screen';

export default async function MealDishDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  return (
    <RequireAuth>
      <MealDishDetailScreen itemId={itemId} />
    </RequireAuth>
  );
}
