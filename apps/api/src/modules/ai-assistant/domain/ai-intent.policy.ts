/**
 * Topic intent filter — message + conversation context (follow-ups).
 */

import {
  resolveConversationContext,
  type ChatHistoryMessage,
  type ResolvedConversationContext,
} from './conversation-context.resolver';

export type ChatTopic =
  | 'FOOD_PRODUCT'
  | 'NUTRITION'
  | 'SPORTS_NUTRITION'
  | 'WEIGHT_GOAL'
  | 'TRAINING'
  | 'WORKOUT_PLAN'
  | 'PROGRESS'
  | 'SHOPPING'
  | 'PRICE'
  | 'HEALTHY_HABITS'
  | 'PLAN_EXPLANATION'
  | 'PUBLIC_FITNESS_KNOWLEDGE'
  | 'CELEBRITY_TRAINING'
  | 'CELEBRITY_DIET'
  | 'FOLLOW_UP'
  | 'GREETING'
  | 'CLARIFY'
  | 'OFFTOPIC';

export type IntentFilterResult = {
  allowed: boolean;
  topic: ChatTopic;
  /** Secondary tags e.g. FOLLOW_UP + FOOD_PRODUCT */
  topics: ChatTopic[];
  confidence: 'high' | 'medium' | 'low';
  refusalMessage?: string;
  clarifyQuestion?: string;
  conversation?: ResolvedConversationContext;
};

const TOPIC_PATTERNS: Array<{ topic: Exclude<ChatTopic, 'OFFTOPIC' | 'FOLLOW_UP' | 'CLARIFY'>; pattern: RegExp }> = [
  { topic: 'GREETING', pattern: /^(привет|здравствуй|добрый\s+(день|вечер|утро)|hello|hi)(\s|$|[!,.])/i },
  {
    topic: 'CELEBRITY_TRAINING',
    pattern:
      /(?:как\s+)?(?:тренир|накач|программ).*(?:арнольд|шварценеггер|зейн|zane|культурист)|(?:арнольд|шварценеггер|зейн|zane).*(?:тренир|программ|качал)|фрэнк\s+зейн|франк\s+зейн|frank\s+zane|schwarzenegger/i,
  },
  {
    topic: 'CELEBRITY_DIET',
    pattern: /(?:что\s+ел|питан|диет|рацион).*(?:арнольд|шварценеггер|зейн|спортсмен|культурист)|(?:арнольд|зейн).*(?:ел|ест|диета|питал)/i,
  },
  {
    topic: 'PUBLIC_FITNESS_KNOWLEDGE',
    pattern: /известный\s+спортсмен|звездн.*(?:тренир|программ)|методик.*(?:бодибилд|культурист)/i,
  },
  {
    topic: 'FOOD_PRODUCT',
    pattern:
      /что\s+такое\s+\w+|киноа|quinoa|крупа|замен.*(?:рис|греч|киноа|макарон)|не\s+нрав.*(?:киноа|рис|греч)|продукт\w*\s+\w+/i,
  },
  {
    topic: 'SPORTS_NUTRITION',
    pattern: /протеин|гейнер|креатин|bcaa|спортпит|сыворотк/i,
  },
  {
    topic: 'WORKOUT_PLAN',
    pattern: /программ.*(?:тренир|недел|месяц)|собери\s+программ|план\s+тренир|сплит|периодизац/i,
  },
  {
    topic: 'TRAINING',
    pattern: /тренир|упражн|зарядк|кардио|сил|ходьб|пробеж|мышц|подход|повтор|оборудован/i,
  },
  {
    topic: 'NUTRITION',
    pattern:
      /питан|питат|еда|рацион|калор|белок|углевод|жир|завтрак|обед|ужин|перекус|яиц|яйц|сладк|хочется|голод|макрос|кбжу|меню|рецепт|порци/i,
  },
  {
    topic: 'WEIGHT_GOAL',
    pattern: /похуд|сброс.*вес|дефицит|вес|похудеть|целев.*вес|жиросжиг|набор\s+массы/i,
  },
  {
    topic: 'PROGRESS',
    pattern: /прогресс|плато|вес\s+стоит|динамик|тренд\s+вес/i,
  },
  {
    topic: 'SHOPPING',
    pattern: /покуп|список|магазин|корзин|собери\s+продукт|на\s+недел/i,
  },
  {
    topic: 'PRICE',
    pattern: /цен|бюджет|дешевл|стоим|ритейл/i,
  },
  {
    topic: 'HEALTHY_HABITS',
    pattern: /привычк|режим|сон|вод|мотивац|дисциплин|ритуал/i,
  },
  {
    topic: 'PLAN_EXPLANATION',
    pattern: /объясн.*план|почему\s+в\s+плане|что\s+означает\s+в\s+плане|разбер.*план/i,
  },
];

export const OFFTOPIC_REFUSAL =
  'Я помогаю с питанием, продуктами, тренировками, прогрессом и покупками. Уточните, пожалуйста, вопрос по одной из этих тем.';

export const GREETING_REPLY =
  'Привет! Чем помочь: разобрать питание, тренировку или прогресс?';

export type IntentFilterOptions = {
  history?: ChatHistoryMessage[];
  tariffTier?: 'FREE' | 'PREMIUM';
};

export function filterChatIntent(message: string, options?: IntentFilterOptions): IntentFilterResult {
  const text = message.trim();
  const conversation = resolveConversationContext(text, options?.history ?? []);

  if (!text) {
    return {
      allowed: false,
      topic: 'OFFTOPIC',
      topics: ['OFFTOPIC'],
      confidence: 'high',
      refusalMessage: OFFTOPIC_REFUSAL,
      conversation,
    };
  }

  for (const { topic, pattern } of TOPIC_PATTERNS) {
    if (!pattern.test(text)) continue;

    const topics: ChatTopic[] = [topic];
    if (conversation.isFollowUp && topic !== 'GREETING') {
      topics.unshift('FOLLOW_UP');
    }

    // Celebrity deep-dive is allowed for all tiers; FREE gets brief capability in prompt.
    return {
      allowed: true,
      topic: conversation.isFollowUp && topic !== 'GREETING' ? 'FOLLOW_UP' : topic,
      topics,
      confidence: 'high',
      conversation,
    };
  }

  // Follow-up of an allowed prior topic → keep it allowed.
  if (conversation.isFollowUp && conversation.activeTopic) {
    const parent = conversation.activeTopic as ChatTopic;
    return {
      allowed: true,
      topic: 'FOLLOW_UP',
      topics: ['FOLLOW_UP', parent],
      confidence: 'medium',
      conversation,
    };
  }

  // Entity from history mentioned without strong topic match.
  if (conversation.entities.length > 0 && conversation.entities.some((e) => text.toLowerCase().includes(e))) {
    const parent = (conversation.activeTopic as ChatTopic) || 'FOOD_PRODUCT';
    return {
      allowed: true,
      topic: 'FOLLOW_UP',
      topics: ['FOLLOW_UP', parent],
      confidence: 'medium',
      conversation,
    };
  }

  // Low confidence: ask one clarifying question instead of hard refuse.
  if (text.length < 80) {
    return {
      allowed: true,
      topic: 'CLARIFY',
      topics: ['CLARIFY'],
      confidence: 'low',
      clarifyQuestion:
        'Уточните, пожалуйста: вопрос про питание, тренировку, прогресс или покупки?',
      conversation,
    };
  }

  return {
    allowed: false,
    topic: 'OFFTOPIC',
    topics: ['OFFTOPIC'],
    confidence: 'low',
    refusalMessage: OFFTOPIC_REFUSAL,
    conversation,
  };
}

/** Primary topic used for context packing (unwrap FOLLOW_UP). */
export function primaryTopicForContext(result: IntentFilterResult): ChatTopic {
  if (result.topic === 'FOLLOW_UP') {
    const parent = result.topics.find((t) => t !== 'FOLLOW_UP');
    if (parent) return parent;
    const fromHistory = result.conversation?.activeTopic;
    if (fromHistory) return fromHistory as ChatTopic;
    return 'NUTRITION';
  }
  return result.topic;
}
