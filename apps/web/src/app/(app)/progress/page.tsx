import { RequireAuth } from '@/features/auth/components/require-auth';
import { ProgressScreen } from '@/features/progress/components/progress-screen';

export default function Page() {
  return (
    <RequireAuth>
      <ProgressScreen />
    </RequireAuth>
  );
}
