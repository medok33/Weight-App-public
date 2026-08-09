import { RequireAuth } from '@/features/auth/components/require-auth';
import { UserProfileScreen } from '../../../features/user-profile/components/user-profile-screen';

export default function Page() {
  return (
    <RequireAuth>
      <UserProfileScreen />
    </RequireAuth>
  );
}
