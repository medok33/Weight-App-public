import { RequireAuth } from '@/features/auth/components/require-auth';
import { DashboardTodayScreen } from '@/features/dashboard-today/components/dashboard-today-screen';

export default function Page() {
  return (
    <RequireAuth>
      <DashboardTodayScreen />
    </RequireAuth>
  );
}
