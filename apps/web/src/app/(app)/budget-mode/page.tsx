import { RequireAuth } from '@/features/auth/components/require-auth';
import { BudgetModeScreen } from '@/features/budget-mode/components/budget-mode-screen';
export default function Page() {
  return <RequireAuth><BudgetModeScreen /></RequireAuth>;
}
