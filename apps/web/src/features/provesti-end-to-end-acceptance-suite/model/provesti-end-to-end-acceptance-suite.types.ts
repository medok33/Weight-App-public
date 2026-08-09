export type AcceptanceScenarioId =
  | 'auth.login'
  | 'dashboard.today'
  | 'meal.plan'
  | 'workout'
  | 'progress'
  | 'shopping'
  | 'export.share'
  | 'health.ready';

export type AcceptanceScenario = {
  id: AcceptanceScenarioId;
  title: string;
  route: string;
};

export type AcceptanceSuiteState = 'loading' | 'empty' | 'error' | 'forbidden' | 'success';

export const ACCEPTANCE_SCENARIOS: AcceptanceScenario[] = [
  { id: 'auth.login', title: 'Login / session', route: '/login' },
  { id: 'dashboard.today', title: 'Dashboard today', route: '/dashboard' },
  { id: 'meal.plan', title: 'Meal plan', route: '/plan/meals' },
  { id: 'workout', title: 'Workout', route: '/plan/workouts' },
  { id: 'progress', title: 'Progress', route: '/progress' },
  { id: 'shopping', title: 'Shopping', route: '/shopping' },
  { id: 'export.share', title: 'Export / documents', route: '/export-share' },
  { id: 'health.ready', title: 'API health ready', route: '/api/health/ready' },
];
