/** STEP_212 Search Before Generate recommendation labels (USER/OWNER facing). */

export function searchRecommendationLabelRu(code: string | null | undefined): string {
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

export function coverageBoardColumnLabelRu(status: string | null | undefined): string {
  switch (String(status ?? '')) {
    case 'EMPTY':
      return 'Пустые';
    case 'UNDERFILLED':
      return 'Недозаполненные';
    case 'COVERED':
      return 'Покрытые';
    case 'OVERFILLED':
      return 'Переполненные';
    case 'NEEDS_REFRESH':
      return 'Требуют обновления';
    default:
      return 'Статус';
  }
}

export function coverageMealTypeLabelRu(mealType: string | null | undefined): string {
  switch (String(mealType ?? '').toLowerCase()) {
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

export function coverageDishTypeLabelRu(dishType: string | null | undefined): string {
  switch (String(dishType ?? '')) {
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

export function coverageCookingMethodLabelRu(method: string | null | undefined): string {
  switch (String(method ?? '').toUpperCase()) {
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

/**
 * Deterministic Russian display title for Coverage slots.
 * Stable slotKey must not be used as the primary UI title.
 */
export function formatCoverageSlotDisplayTitleRu(input: {
  mealType?: string | null;
  primaryProductName?: string | null;
  dishType?: string | null;
  cookingMethod?: string | null;
  dietaryProfile?: string | null;
}): string {
  const meal = coverageMealTypeLabelRu(input.mealType);
  const product = String(input.primaryProductName ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU');
  const dish = coverageDishTypeLabelRu(input.dishType);
  const method = coverageCookingMethodLabelRu(input.cookingMethod);

  if (dish === 'каша' && !product) return `${meal}: каша`;
  if (dish === 'гарнир' && product) return `${meal}: гарнир из ${product}`;
  if (method === 'запекание' && product) return `${meal}: запечённое блюдо с ${product}`;
  if (product && method) return `${meal}: ${product}, ${dish} ${method}`;
  if (product) return `${meal}: ${product}, ${dish}`;
  if (method) return `${meal}: ${dish} ${method}`;
  return `${meal}: ${dish}`;
}
