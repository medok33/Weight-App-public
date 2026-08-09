import { RequireAuth } from '@/features/auth/components/require-auth';
import { AccountPrivacyPanel } from '@/features/auth/components/account-privacy-panel';
import { UserProfileScreen } from '../../../features/user-profile/components/user-profile-screen';

export default function Page() {
  return (
    <RequireAuth>
      <UserProfileScreen />
      <AccountPrivacyPanel />
    </RequireAuth>
  );
}
