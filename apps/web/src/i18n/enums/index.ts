/** Centralized domain enum → Russian display labels (UI-RU-01). Canonical codes stay in API/DB. */

export function labelLifecycleStatus(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'IN_REVIEW':
      return 'На проверке';
    case 'APPROVED':
      return 'Одобрена';
    case 'PUBLISHED':
      return 'Опубликована';
    case 'SUPERSEDED':
      return 'Заменена новой';
    case 'SUSPENDED':
      return 'Приостановлена';
    case 'ARCHIVED':
      return 'Архивирована';
    case 'REJECTED':
      return 'Отклонена';
    default:
      return 'Статус не задан';
  }
}

export function labelLifecycleAction(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'APPROVE':
      return 'Одобрить';
    case 'REJECT':
      return 'Отклонить';
    case 'PUBLISH':
      return 'Опубликовать';
    case 'SUSPEND':
      return 'Приостановить';
    case 'RESTORE':
      return 'Восстановить';
    case 'ARCHIVE':
      return 'Архивировать';
    default:
      return 'Действие';
  }
}

export function labelDataClass(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'PRODUCTION':
      return 'Рабочий рецепт';
    case 'TEST_ONLY':
      return 'Тестовый рецепт';
    case 'FIXTURE':
      return 'Тестовые данные';
    case 'HISTORICAL_ONLY':
      return 'Историческая запись';
    case 'LEGACY':
      return 'Устаревшая запись';
    case 'ARCHIVED_DATA':
      return 'Архивные данные';
    default:
      return 'Класс данных';
  }
}

export function labelValidationStatus(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'VALID':
      return 'Проверен';
    case 'NEEDS_REVALIDATION':
      return 'Требует повторной проверки';
    case 'BLOCKED':
      return 'Заблокирован';
    default:
      return 'Статус проверки';
  }
}

export function labelCoverageStatus(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'EMPTY':
      return 'Пустой';
    case 'UNDERFILLED':
      return 'Заполнен недостаточно';
    case 'COVERED':
      return 'Покрыт';
    case 'OVERFILLED':
      return 'Заполнен сверх цели';
    case 'NEEDS_REFRESH':
      return 'Требует пересчёта';
    default:
      return 'Статус слота';
  }
}

export function labelCoveragePriority(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'CRITICAL':
    case 'P0':
      return 'Критический';
    case 'HIGH':
    case 'P1':
      return 'Высокий';
    case 'MEDIUM':
    case 'P2':
      return 'Средний';
    case 'LOW':
    case 'P3':
      return 'Низкий';
    default:
      return 'Приоритет';
  }
}

export function labelMealType(code: string | null | undefined): string {
  switch (String(code ?? '').toLowerCase()) {
    case 'breakfast':
      return 'Завтрак';
    case 'lunch':
      return 'Обед';
    case 'dinner':
      return 'Ужин';
    case 'snack':
      return 'Перекус';
    case 'afternoon_snack':
      return 'Полдник';
    default:
      return 'Приём пищи';
  }
}

export function labelDishType(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'MAIN':
      return 'основное блюдо';
    case 'SOUP':
      return 'суп';
    case 'SALAD':
      return 'салат';
    case 'PORRIDGE':
      return 'каша';
    case 'SNACK':
      return 'перекус';
    case 'SIDE':
      return 'гарнир';
    case 'BREAKFAST':
      return 'завтрак';
    case 'BOWL':
      return 'боул';
    case 'UNCLASSIFIED':
      return 'без типа';
    default:
      return 'блюдо';
  }
}

export function labelCookingMethod(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'RAW':
      return 'без термообработки';
    case 'BOIL':
      return 'варка';
    case 'BAKE':
      return 'запекание';
    case 'FRY':
      return 'жарка';
    case 'STEW':
      return 'тушение';
    case 'STEAM':
      return 'на пару';
    case 'GRILL':
      return 'гриль';
    case 'MIX':
      return 'смешивание';
    case 'BLEND':
      return 'взбивание';
    case 'STOVE':
      return 'на плите';
    default:
      return '';
  }
}

export function labelSearchRecommendation(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'USE_EXISTING_RECIPE':
      return 'Использовать существующий рецепт';
    case 'ADJUST_PORTION_OF_EXISTING':
      return 'Подходит после изменения порции';
    case 'ADAPT_EXISTING_RECIPE':
      return 'Можно адаптировать существующий рецепт';
    case 'CREATE_FAMILY_VARIANT':
      return 'Нужен отдельный вариант семейства';
    case 'REVIEW_DUPLICATE_CANDIDATES':
      return 'Сначала проверить возможные дубликаты';
    case 'RESEARCH_REQUIRED':
      return 'Требуется исследование нового рецепта';
    case 'BLOCKED_NO_SAFE_ACTION':
      return 'Безопасное действие пока невозможно';
    default:
      return 'Рекомендация не сформирована';
  }
}

export function labelRevalidationStatus(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'OPEN':
      return 'Открыта';
    case 'RESOLVED':
      return 'Решена';
    case 'DISMISSED':
      return 'Отклонена';
    default:
      return 'Статус проверки';
  }
}

export function labelSeverity(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'INFO':
      return 'Информация';
    case 'WARNING':
      return 'Предупреждение';
    case 'HIGH':
      return 'Высокий риск';
    case 'CRITICAL':
      return 'Критическая проблема';
    default:
      return 'Важность';
  }
}

export function labelRevalidationReason(code: string | null | undefined): {
  title: string;
  description: string;
} {
  switch (String(code ?? '')) {
    case 'PRODUCT_NUTRITION_VERSION_CHANGED':
      return {
        title: 'Изменились данные КБЖУ продукта',
        description:
          'Для продукта опубликована новая версия пищевой ценности. Проверьте расчёт рецепта.',
      };
    default:
      return {
        title: 'Требуется повторная проверка',
        description: 'Проверьте актуальность данных рецепта.',
      };
  }
}

export function labelDuplicateKind(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'EXACT':
      return 'Точный дубликат';
    case 'NEAR':
      return 'Возможный дубликат';
    case 'FAMILY_VARIANT':
      return 'Вариант того же блюда';
    default:
      return 'Кандидат на дубликат';
  }
}

export function labelMediaRights(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'OWNED_UPLOAD':
      return 'Загружено владельцем';
    case 'ALL_RIGHTS_OWNED':
      return 'Все права принадлежат проекту';
    case 'PENDING':
      return 'Ожидает проверки';
    case 'APPROVED':
      return 'Одобрено';
    case 'BLOCKED':
      return 'Заблокировано';
    case 'TAKEDOWN':
      return 'Снято с публикации';
    case 'REJECTED':
      return 'Отклонено';
    case 'MEDIA_STORAGE_NOT_CONFIGURED':
      return 'Хранилище медиа не настроено';
    default:
      return 'Статус медиа';
  }
}

export function labelSourceRights(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'ACTIVE_LICENSED':
      return 'Лицензированный источник';
    case 'PUBLIC_RESEARCH_ALLOWED':
      return 'Разрешено ограниченное исследование';
    case 'MANUAL_RESEARCH_ONLY':
      return 'Только ручное исследование';
    case 'SUSPENDED':
      return 'Временно приостановлен';
    case 'DISABLED_BY_TERMS':
      return 'Отключён из-за условий использования';
    case 'DISABLED_BY_REFUSAL':
      return 'Отключён после отказа';
    case 'PENDING_REVIEW':
      return 'Ожидает проверки';
    default:
      return 'Статус прав';
  }
}

export function labelCollectionMode(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'API':
      return 'API';
    case 'LICENSED_FEED':
      return 'Лицензированный канал данных';
    case 'PUBLIC_FEED':
      return 'Публичный канал данных';
    case 'CONTROLLED_HTML_RESEARCH':
      return 'Контролируемое исследование страниц';
    case 'MANUAL_ENTRY':
      return 'Ручной ввод';
    case 'MANUAL_REFERENCE_ONLY':
      return 'Только ручная ссылка';
    case 'DISABLED':
      return 'Сбор отключён';
    default:
      return 'Режим сбора';
  }
}

export function labelExecutionState(code: string | null | undefined): string {
  switch (String(code ?? '')) {
    case 'AUTOMATED_ALLOWED':
      return 'Автоматическая работа разрешена';
    case 'MANUAL_ONLY':
      return 'Только ручная работа';
    case 'TEMPORARILY_SUSPENDED':
      return 'Временно приостановлено';
    case 'RIGHTS_BLOCKED':
      return 'Заблокировано правами';
    case 'CONFIGURATION_BLOCKED':
      return 'Ошибка конфигурации';
    case 'RATE_LIMIT_BLOCKED':
      return 'Превышено ограничение запросов';
    case 'HEALTH_BLOCKED':
      return 'Источник временно недоступен';
    case 'NOT_CONFIGURED':
      return 'Не настроено';
    default:
      return 'Состояние выполнения';
  }
}

/**
 * Deterministic Coverage slot title from structured fields.
 * Never use raw slotKey as the primary display title.
 */
export function formatCoverageSlotTitle(input: {
  mealType?: string | null;
  primaryProductName?: string | null;
  dishType?: string | null;
  cookingMethod?: string | null;
  dietaryProfile?: string | null;
}): string {
  const meal = labelMealType(input.mealType);
  const product = String(input.primaryProductName ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU');
  const dish = labelDishType(input.dishType);
  const method = labelCookingMethod(input.cookingMethod);
  const dietary =
    input.dietaryProfile && input.dietaryProfile !== 'GENERAL'
      ? String(input.dietaryProfile)
      : '';

  if (dish === 'каша' && !product) {
    return `${meal}: каша`;
  }
  if (dish === 'гарнир' && product) {
    return `${meal}: гарнир из ${product}`;
  }
  if (method === 'запекание' && product) {
    return `${meal}: запечённое блюдо с ${product}`;
  }
  if (product && method) {
    return `${meal}: ${product}, ${dish} ${method}`;
  }
  if (product) {
    return `${meal}: ${product}, ${dish}`;
  }
  if (method) {
    return `${meal}: ${dish} ${method}`;
  }
  if (dietary) {
    return `${meal}: ${dish} (${dietary})`;
  }
  return `${meal}: ${dish}`;
}
