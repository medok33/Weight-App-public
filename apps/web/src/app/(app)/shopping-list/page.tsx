import { RequireAuth } from '@/features/auth/components/require-auth';
import { ShoppingListScreen } from '@/features/shopping-list/components/shopping-list-screen';

export default function Page() {
  return (
    <RequireAuth>
      <ShoppingListScreen />
    </RequireAuth>
  );
}
