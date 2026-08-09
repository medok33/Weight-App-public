import { RequireAuth } from '@/features/auth/components/require-auth';
import { WorkoutSessionScreen } from '@/features/workout-engine/components/workout-session-screen';

export default function WorkoutSessionPage() {
  return (
    <RequireAuth>
      <WorkoutSessionScreen />
    </RequireAuth>
  );
}
