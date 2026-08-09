import { RequireAuth } from '@/features/auth/components/require-auth';
import { OnboardingWizardScreen } from '@/features/onboarding/components/onboarding-wizard-screen';

export default function Page() {
  return (
    <RequireAuth>
      <OnboardingWizardScreen />
    </RequireAuth>
  );
}
