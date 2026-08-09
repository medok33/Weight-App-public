/**
 * Conversation context for follow-ups ("это", "замени", product names from prior turns).
 * Note: avoid JS \\b with Cyrillic — it does not treat Cyrillic as word characters.
 */

export type ChatHistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type ResolvedConversationContext = {
  recentMessages: ChatHistoryMessage[];
  entities: string[];
  activeTopic: string | null;
  isFollowUp: boolean;
  followUpHints: string[];
};

const FOLLOW_UP_PATTERN =
  /(это|его|её|ее|замен|не\s*нрав|непонят|не\s*пон|другой\s+вариант|чем\s+замен|вместо|продолж|ещё|еще)/i;

const FOOD_ENTITY_PATTERN =
  /(киноа|quinoa|гречк\w*|рис\w*|овсян\w*|булгур\w*|макарон\w*|яйц\w*|курин\w*|творог\w*|лосос\w*|протеин\w*|гейнер\w*)/gi;

const CELEBRITY_ENTITY_PATTERN =
  /(арнольд\w*|шварценеггер\w*|arnold|франк|фрейк|зейн|zane|культурист\w*)/gi;

const TOPIC_HINT_PATTERNS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: 'FOOD_PRODUCT', pattern: /киноа|quinoa|крупа|продукт|замен/i },
  { topic: 'NUTRITION', pattern: /рацион|калор|белок|питан|меню|завтрак|обед|ужин/i },
  { topic: 'TRAINING', pattern: /тренир|упражн|подход|повтор/i },
  { topic: 'CELEBRITY_TRAINING', pattern: /арнольд|шварценеггер|зейн|zane|культурист/i },
  { topic: 'SHOPPING', pattern: /покуп|список|бюджет|магазин/i },
  { topic: 'WEIGHT_GOAL', pattern: /похуд|вес|дефицит/i },
];

function extractEntities(text: string): string[] {
  const found = new Set<string>();
  for (const re of [FOOD_ENTITY_PATTERN, CELEBRITY_ENTITY_PATTERN]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.add(m[0].toLowerCase());
    }
  }
  return [...found];
}

function inferTopicFromText(text: string): string | null {
  for (const { topic, pattern } of TOPIC_HINT_PATTERNS) {
    if (pattern.test(text)) return topic;
  }
  return null;
}

export function resolveConversationContext(
  currentMessage: string,
  history: ChatHistoryMessage[],
  options?: { limit?: number },
): ResolvedConversationContext {
  const limit = options?.limit ?? 12;
  const recent = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }));

  const entities = new Set<string>();
  for (const m of recent) {
    for (const e of extractEntities(m.content)) entities.add(e);
  }
  for (const e of extractEntities(currentMessage)) entities.add(e);

  let activeTopic: string | null = null;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const topic = inferTopicFromText(recent[i]!.content);
    if (topic) {
      activeTopic = topic;
      break;
    }
  }

  const text = currentMessage.trim();
  const mentionsPriorEntity = [...entities].some((e) => text.toLowerCase().includes(e) && recent.some((m) => m.content.toLowerCase().includes(e)));
  const followPattern = FOLLOW_UP_PATTERN.test(text);
  const isFollowUp = recent.length > 0 && (followPattern || (mentionsPriorEntity && text.length < 200));

  const followUpHints: string[] = [];
  if (followPattern) followUpHints.push('pronoun_or_replacement');
  if (mentionsPriorEntity) followUpHints.push('prior_entity');

  return {
    recentMessages: recent,
    entities: [...entities],
    activeTopic,
    isFollowUp,
    followUpHints,
  };
}
