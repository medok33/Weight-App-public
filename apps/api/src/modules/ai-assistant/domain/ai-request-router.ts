/**
 * Request complexity classifier (metrics / style hints).
 * Model selection is tariff-driven (V4 flash vs pro), not alias-based.
 */

export type AIRequestComplexity = 'SIMPLE' | 'ANALYSIS';

export type AIRouteDecision = {
  complexity: AIRequestComplexity;
  preferredModel: string;
  reason: string;
};

const ANALYSIS_HINTS =
  /почему|разбер|анализ|сравни|план на неделю|стратег|оптимиз|рассчитай|почему хочется|дефицит|макрос|прогресс за|почему я|как лучше|детально|подробн/i;

const DEEP_ANALYSIS_HINTS =
  /анализ|стратегия|пересмотр плана|разбор рациона|почему не худею|плато|сравни магазины|оптимизируй бюджет/i;

export function classifyRequestComplexity(message: string): AIRouteDecision {
  const text = message.trim();
  if (DEEP_ANALYSIS_HINTS.test(text) || ANALYSIS_HINTS.test(text)) {
    return {
      complexity: 'ANALYSIS',
      preferredModel: 'deepseek-v4-pro',
      reason: 'analysis_keywords',
    };
  }
  return {
    complexity: 'SIMPLE',
    preferredModel: 'deepseek-v4-flash',
    reason: 'default_simple',
  };
}

/**
 * Final model always follows the tariff (FREE → flash, PREMIUM → pro).
 * Complexity does not override tier model after V4 migration.
 */
export function resolveRoutedModel(
  complexity: AIRequestComplexity,
  tariffModel: string,
  tariffTier: 'FREE' | 'PREMIUM',
): string {
  void complexity;
  void tariffTier;
  return tariffModel;
}
