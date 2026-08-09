import { RequireAuth } from '@/features/auth/components/require-auth';
import { PantryScreen } from '@/features/pantry/components/pantry-screen';

export default function Page() {
  return (
    <RequireAuth>
      <PantryScreen />
    </RequireAuth>
  );
}
