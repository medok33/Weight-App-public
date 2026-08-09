import type { AICompletionRequest, AICompletionResult, AIProviderAdapter } from '../domain/ai-provider.interface';
import { formatGoalFirstResponse, formatMockStyleResponse } from '../domain/ai-response-style';
import { GREETING_REPLY } from '../domain/ai-intent.policy';

/** Local/dev mock — production uses DeepSeek when AI_PROVIDER=deepseek. */
export class LocalProvider implements AIProviderAdapter {
  readonly providerId = 'local';

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
    const userText = lastUser?.content ?? '';
    const lower = userText.toLowerCase();
    const model = request.model ?? 'local-mock-v1';

    let content: string;
    if (/киноа|quinoa/.test(lower)) {
      content = formatGoalFirstResponse({
        answer:
          'Киноа — это крупа с мягким ореховым вкусом, которую используют примерно как рис или гречку. Она содержит углеводы, клетчатку и немного больше белка, чем многие обычные крупы.',
        goalLink:
          'Если киноа вам не нравится, в вашем плане её можно заменить рисом, гречкой, булгуром или цельнозерновыми макаронами. Для вашей цели важнее подходящая калорийность и порция, а не сама киноа.',
      });
    } else if (/зейн|zane/.test(lower)) {
      content = formatGoalFirstResponse({
        answer:
          'По публично известным данным Фрэнк Зейн известен более «эстетичным» объёмом и контролем формы; его подходы различались в разные периоды, точный режим мог меняться.',
        applicability:
          'Ниже не копия его программы, а ориентир: при недостатке данных анкеты сначала уточните частоту, оборудование и ограничения.',
        action: 'Где будете тренироваться: дома или в зале? Сколько тренировок в неделю удобно? Есть ли ограничения?',
      });
    } else if (/арнольд|шварценеггер|arnold|schwarzenegger/.test(lower)) {
      content = formatGoalFirstResponse({
        answer:
          'По публично известным данным Арнольд сочетал высокий объём на мышцы (в т.ч. руки), суперсеты и жёсткую прогрессию; программы различались по годам.',
        applicability:
          'Профессиональный объём нельзя копировать без адаптации. Ниже не копия его программы, а адаптация под обычные условия.',
        goalLink: system.includes('Goal Core')
          ? 'Для цели снижения веса полезнее умеренный объём и восстановление, а не чемпионский сплит.'
          : undefined,
        action: 'Добавьте 2–3 рабочих подхода на отстающую группу к текущей программе на неделю.',
      });
    } else if (/привет|hello|здрав/.test(lower)) {
      content = GREETING_REPLY;
    } else if (/яиц|яйц/.test(lower)) {
      content = formatGoalFirstResponse({
        answer: 'Яйца — нормальный белковый продукт; количество зависит от рациона в целом.',
        bullets: [
          '2–3 яйца в день обычно уместны',
          '10 яиц каждый день часто избыточны',
          'Смотрите общий белок и калории дня',
        ],
      });
    } else if (/покуп|собери\s+продукт|на\s+недел/.test(lower)) {
      const hasPrices = system.includes('Цены') && !system.includes('Цены: нет данных');
      content = formatGoalFirstResponse({
        answer: hasPrices
          ? 'Соберу ориентир покупок из вашего плана и списка. Где цена есть — укажу источник и дату; где нет — отмечу отсутствие.'
          : 'Сначала сгенерируйте список покупок из плана питания — тогда смогу опереться на реальные позиции.',
        applicability:
          'Точный недельный бюджет не утверждаю, если у части товаров нет актуальной цены.',
      });
    } else if (/похуд|вес|прогресс/.test(lower)) {
      content = formatMockStyleResponse(
        'Здоровый темп — примерно до порога осторожности по кг/неделю относительно вашего срока.',
        ['Смотрите недельный тренд', 'Держите белок', 'Без голодания'],
        'Запишите вес в «Прогресс».',
      );
    } else {
      content = formatGoalFirstResponse({
        answer: 'Кратко отвечаю по вашему вопросу с учётом доступного контекста.',
        bullets: ['Питание и активность', 'Без выдуманных цен и чужих точных программ'],
      });
    }

    const promptTokens = Math.ceil(request.messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
    const completionTokens = Math.ceil(content.length / 4);
    return {
      content,
      providerId: this.providerId,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      latencyMs: 1,
      thinkingEnabled: request.thinking?.type === 'enabled',
    };
  }
}
