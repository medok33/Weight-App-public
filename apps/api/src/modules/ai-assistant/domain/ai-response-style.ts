/**
 * Response style: direct answers; personalization blocks only when useful.
 */

export const RESPONSE_STYLE_INSTRUCTION = [
  'Стиль ответа:',
  '- Сразу отвечай на вопрос. Простой вопрос = 2–5 коротких абзацев или пунктов.',
  '- Не делай длинное вступление и не пересказывай всю анкету.',
  '- Блоки «применимость» и «действие сейчас» добавляй только если реально полезны (не в каждом простом ответе).',
  '- Подробный разбор / программа / сравнение — только если пользователь явно просит.',
  '- Не обещай гарантированный результат. Не предлагай голодание и опасные ограничения.',
  '- Цель пользователя учитывай, но не вставляй Goal Core механически в каждый ответ.',
].join('\n');

export const AGGRESSIVE_GOAL_INSTRUCTION = [
  'Оценка цели: темп снижения/набора выглядит AGGRESSIVE относительно срока.',
  'Не запрещай цель и не меняй её автоматически.',
  'Учти желаемый результат, не обещай его достижение, объясни что темп высокий,',
  'предложи более разумную стратегию без голодания и опасных ограничений.',
].join(' ');

export const CELEBRITY_INSTRUCTION = [
  'Вопросы о известных спортсменах:',
  '- разделяй публично известные данные, неопределённость и свою адаптацию;',
  '- формулировки: «по публично известным данным», «программы различались в разные периоды»,',
  '  «точный режим мог меняться», «ниже не копия его программы, а адаптация под ваши условия»;',
  '- не утверждай без оснований конкретные ежедневные схемы;',
  '- не выдавай выдуманную точную программу под видом методики знаменитости;',
  '- интернет-поиска нет.',
].join('\n');

export const WORKOUT_PROGRAM_INSTRUCTION = [
  'Создание тренировочной программы:',
  '- если неизвестны trainingLevel / workoutsPerWeek / availableEquipment / ограничения / текущая программа / цель —',
  '  задай максимум 3 коротких вопроса и не составляй подробную недельную программу;',
  '- после ответов можно дать дни, упражнения, подходы, повторения, отдых, прогрессию и связь с целью.',
].join('\n');

export const SHOPPING_PRICE_INSTRUCTION = [
  'Покупки и цены:',
  '- используй только данные Meal Plan / Shopping List / PriceObservation из контекста;',
  '- для цены указывай retailer, sourceType, collectedAt когда есть;',
  '- не придумывай точную цену; если цены нет — скажи об этом;',
  '- разделяй подтверждённую, приблизительную стоимость и товары без цены;',
  '- не утверждай точный недельный бюджет, если часть товаров без цен.',
].join('\n');

export function formatMockStyleResponse(shortAnswer: string, bullets: string[], tip: string): string {
  const points = bullets.slice(0, 5).map((b) => `• ${b}`);
  return [shortAnswer, '', ...points, '', `Совет: ${tip}`].join('\n');
}

export function formatGoalFirstResponse(parts: {
  answer: string;
  applicability?: string;
  goalLink?: string;
  action?: string;
  bullets?: string[];
}): string {
  const lines = [parts.answer];
  if (parts.applicability) lines.push('', parts.applicability);
  if (parts.goalLink) lines.push(parts.goalLink);
  const bullets = (parts.bullets ?? []).slice(0, 4).map((b) => `• ${b}`);
  if (bullets.length) lines.push('', ...bullets);
  if (parts.action) lines.push('', parts.action);
  return lines.join('\n');
}
