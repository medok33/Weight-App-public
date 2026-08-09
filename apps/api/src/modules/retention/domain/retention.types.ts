export type BetaOnboardingStepKey =
  | 'welcome'
  | 'profile_goal'
  | 'meal_plan_intro'
  | 'feedback_invite';

export type BetaOnboardingStep = {
  key: BetaOnboardingStepKey;
  title: string;
  required: boolean;
};

export type BetaOnboardingStatus = {
  steps: Array<BetaOnboardingStep & { completed: boolean; completedAt: string | null }>;
  completedCount: number;
  totalRequired: number;
  complete: boolean;
};

export type BetaFeedbackCategory = 'product' | 'safety' | 'ux' | 'other';

export type BetaFeedbackInput = {
  userId: string;
  category: BetaFeedbackCategory;
  message: string;
  idempotencyKey: string;
};

export type BetaFeedbackRecord = BetaFeedbackInput & {
  id: string;
  createdAt: string;
};

export type NotificationCategory = 'meal' | 'workout' | 'progress' | 'shopping' | 'family' | 'payments' | 'security' | 'system';
export type NotificationChannel = 'in_app' | 'email' | 'push';
export type NotificationPreferences = { userId: string; channels: Record<NotificationChannel, boolean>; quietHoursStart?: string | null; quietHoursEnd?: string | null; timezone?: string | null; categoryOpts?: Partial<Record<NotificationCategory, boolean>> };
export type EngagementState = { userId: string; successfulDaysTotal: number; bestStreakDays: number; currentStreakDays: number; paused: boolean; lastActiveOn?: string | null; remindersEnabled: boolean };
