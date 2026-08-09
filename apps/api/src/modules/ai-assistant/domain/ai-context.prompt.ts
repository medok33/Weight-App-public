import type { AIConversationContext } from './ai-conversation-context.types';
import {
  RESPONSE_STYLE_INSTRUCTION,
  AGGRESSIVE_GOAL_INSTRUCTION,
  CELEBRITY_INSTRUCTION,
  WORKOUT_PROGRAM_INSTRUCTION,
  SHOPPING_PRICE_INSTRUCTION,
} from './ai-response-style';
import { MEDICAL_DISCLAIMER } from './ai-medical.policy';
import { assessGoalPace, type GoalCore } from './ai-goal-core';
import { capabilityInstructionFor } from './ai-capability.policy';
import type { AITariffTier } from './ai-tariff.types';
import type { SelectedContextBundle } from './ai-context-selection';
import type { ChatTopic } from './ai-intent.policy';
import type { ResolvedConversationContext } from './conversation-context.resolver';

function section(title: string, payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return `${title}: нет данных`;
  return `${title}:\n${JSON.stringify(payload, null, 2)}`;
}

export type SystemPromptOptions = {
  medicalDisclaimer?: boolean;
  tariffTier?: AITariffTier;
  selected?: SelectedContextBundle;
  topic?: ChatTopic;
  conversation?: ResolvedConversationContext;
};

function goalCoreSection(goalCore: GoalCore): string {
  return section('Goal Core', goalCore as unknown as Record<string, unknown>);
}

export function buildSystemPrompt(snapshot: AIConversationContext, options?: SystemPromptOptions): string {
  const selected = options?.selected;
  const data = selected
    ? {
        nutritionToday: selected.data.nutritionToday,
        mealPlan: selected.data.mealPlan,
        workout: selected.data.workout,
        progress: selected.data.progress,
        shopping: selected.data.shopping,
        priceIntelligence: selected.data.priceIntelligence,
      }
    : snapshot.data;

  const tier = options?.tariffTier ?? 'FREE';
  const topic = options?.topic;
  const pace = assessGoalPace(snapshot.data.goalCore);

  const parts = [
    'Ты персональный AI-ассистент Weight App.',
    'Отвечай на языке пользователя (предпочтительно русский).',
    'Не выдумывай факты о пользователе, ценах и программах знаменитостей.',
    '',
    RESPONSE_STYLE_INSTRUCTION,
    '',
    capabilityInstructionFor(tier),
    '',
    goalCoreSection(snapshot.data.goalCore),
    `Оценка темпа цели: ${pace.status}` +
      (pace.requiredChangePerWeek != null
        ? ` (~${pace.requiredChangePerWeek.toFixed(2)} кг/нед, порог ${pace.cautionKgPerWeek})`
        : ''),
  ];

  if (pace.status === 'AGGRESSIVE' || pace.status === 'CONFLICTING') {
    parts.push('', AGGRESSIVE_GOAL_INSTRUCTION);
  }

  if (
    topic === 'CELEBRITY_TRAINING' ||
    topic === 'CELEBRITY_DIET' ||
    topic === 'PUBLIC_FITNESS_KNOWLEDGE'
  ) {
    parts.push('', CELEBRITY_INSTRUCTION);
  }

  if (topic === 'WORKOUT_PLAN' || topic === 'TRAINING') {
    parts.push('', WORKOUT_PROGRAM_INSTRUCTION);
  }

  if (topic === 'SHOPPING' || topic === 'PRICE') {
    parts.push('', SHOPPING_PRICE_INSTRUCTION);
  }

  if (options?.conversation?.isFollowUp) {
    parts.push(
      '',
      'Это продолжение диалога. Учти предыдущие реплики и сущности:',
      JSON.stringify(
        {
          entities: options.conversation.entities,
          activeTopic: options.conversation.activeTopic,
          hints: options.conversation.followUpHints,
        },
        null,
        2,
      ),
    );
  }

  parts.push(
    '',
    'Дополнительный контекст по теме (не полный дамп):',
    section('Питание сегодня', data.nutritionToday as Record<string, unknown> | null),
    section('План питания', data.mealPlan as Record<string, unknown> | null),
    section('Тренировки', data.workout as Record<string, unknown> | null),
    section('Прогресс', data.progress as Record<string, unknown> | null),
    section('Список покупок', data.shopping as Record<string, unknown> | null),
    section('Цены', data.priceIntelligence as Record<string, unknown> | null),
    '',
    `Контекст: ${snapshot.generatedAt} (dataVersion=${snapshot.dataVersion})`,
    selected ? `Домены: ${selected.domains.join(', ')}` : '',
  );

  if (options?.medicalDisclaimer) {
    parts.push('', `Медицинская оговорка (упомяни): ${MEDICAL_DISCLAIMER}`);
  }

  return parts.filter(Boolean).join('\n');
}
