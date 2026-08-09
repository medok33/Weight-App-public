import { RequireAuth } from '@/features/auth/components/require-auth';
import { WorkoutEngineScreen } from '@/features/workout-engine/components/workout-engine-screen';

export default function WorkoutEnginePage() {
  return (
    <RequireAuth>
      <WorkoutEngineScreen />
    </RequireAuth>
  );
}
