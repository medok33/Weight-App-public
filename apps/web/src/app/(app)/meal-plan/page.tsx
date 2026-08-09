import { RequireAuth } from '@/features/auth/components/require-auth';
import { MealPlanScreen } from '@/features/meal-plan/components/meal-plan-screen';

export default function MealPlanPage() {
  return (
    <RequireAuth>
      <MealPlanScreen />
    </RequireAuth>
  );
}
