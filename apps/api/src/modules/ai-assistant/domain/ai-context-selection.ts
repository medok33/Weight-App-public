import type { ChatTopic } from './ai-intent.policy';
import type { AIConversationContext, AIConversationContextData, ContextSourceFlags } from './ai-conversation-context.types';

export type ContextDomain =
  | 'GOAL_CORE'
  | 'NUTRITION'
  | 'TRAINING'
  | 'PROGRESS'
  | 'SHOPPING'
  | 'PUBLIC_FITNESS_KNOWLEDGE';

const TOPIC_TO_DOMAINS: Partial<Record<ChatTopic, ContextDomain[]>> = {
  GREETING: ['GOAL_CORE'],
  CLARIFY: ['GOAL_CORE'],
  FOOD_PRODUCT: ['GOAL_CORE', 'NUTRITION'],
  NUTRITION: ['GOAL_CORE', 'NUTRITION'],
  SPORTS_NUTRITION: ['GOAL_CORE', 'NUTRITION'],
  PLAN_EXPLANATION: ['GOAL_CORE', 'NUTRITION', 'TRAINING'],
  WEIGHT_GOAL: ['GOAL_CORE', 'NUTRITION', 'PROGRESS'],
  PROGRESS: ['GOAL_CORE', 'PROGRESS', 'NUTRITION'],
  HEALTHY_HABITS: ['GOAL_CORE', 'PROGRESS', 'NUTRITION'],
  TRAINING: ['GOAL_CORE', 'TRAINING'],
  WORKOUT_PLAN: ['GOAL_CORE', 'TRAINING'],
  PUBLIC_FITNESS_KNOWLEDGE: ['GOAL_CORE', 'TRAINING', 'PUBLIC_FITNESS_KNOWLEDGE'],
  CELEBRITY_TRAINING: ['GOAL_CORE', 'TRAINING', 'PUBLIC_FITNESS_KNOWLEDGE'],
  CELEBRITY_DIET: ['GOAL_CORE', 'NUTRITION', 'PUBLIC_FITNESS_KNOWLEDGE'],
  SHOPPING: ['GOAL_CORE', 'SHOPPING', 'NUTRITION'],
  PRICE: ['GOAL_CORE', 'SHOPPING'],
  FOLLOW_UP: ['GOAL_CORE', 'NUTRITION'],
  OFFTOPIC: ['GOAL_CORE'],
};

export function domainsForTopic(topic: ChatTopic): ContextDomain[] {
  return TOPIC_TO_DOMAINS[topic] ?? ['GOAL_CORE'];
}

export type SelectedContextBundle = {
  domains: ContextDomain[];
  data: Pick<
    AIConversationContextData,
    'nutritionToday' | 'mealPlan' | 'workout' | 'progress' | 'shopping' | 'priceIntelligence'
  >;
  flags: Pick<ContextSourceFlags, 'nutritionToday' | 'mealPlan' | 'workout' | 'progress' | 'shopping' | 'prices'>;
};

export function selectTopicContext(snapshot: AIConversationContext, topic: ChatTopic): SelectedContextBundle {
  const domains = domainsForTopic(topic);
  const include = (domain: ContextDomain) => domains.includes(domain);
  const { data, flags } = snapshot;

  const nutrition = include('NUTRITION');
  const training = include('TRAINING') || include('PUBLIC_FITNESS_KNOWLEDGE');
  const progress = include('PROGRESS');
  const shopping = include('SHOPPING');

  return {
    domains,
    data: {
      nutritionToday: nutrition ? data.nutritionToday : null,
      mealPlan: nutrition || shopping ? data.mealPlan : null,
      workout: training ? data.workout : null,
      progress: progress ? data.progress : null,
      shopping: shopping ? data.shopping : null,
      priceIntelligence: shopping ? data.priceIntelligence : null,
    },
    flags: {
      nutritionToday: nutrition && flags.nutritionToday,
      mealPlan: (nutrition || shopping) && flags.mealPlan,
      workout: training && flags.workout,
      progress: progress && flags.progress,
      shopping: shopping && flags.shopping,
      prices: shopping && flags.prices,
    },
  };
}
