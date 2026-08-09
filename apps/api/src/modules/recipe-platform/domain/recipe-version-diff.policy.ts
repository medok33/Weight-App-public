/** Readable RecipeVersion diff (STEP_212) — never raw JSON string compare. */

type IngredientLike = {
  productId?: string | null;
  productName?: string | null;
  quantity?: number | string | null;
  amount?: number | string | null;
  unit?: string | null;
  form?: string | null;
};

type StepLike = {
  order?: number | null;
  position?: number | null;
  text?: string | null;
  instruction?: string | null;
};

export type RecipeVersionDiffSection = {
  field: string;
  labelRu: string;
  before: unknown;
  after: unknown;
  changeKind: 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
};

export type RecipeVersionDiffResult = {
  sections: RecipeVersionDiffSection[];
  ingredientChanges: Array<{
    kind: 'ADDED' | 'REMOVED' | 'QUANTITY_CHANGED' | 'PRODUCT_REPLACED' | 'UNCHANGED';
    productId?: string | null;
    productName?: string | null;
    beforeQuantity?: string | null;
    afterQuantity?: string | null;
    beforeProductId?: string | null;
    afterProductId?: string | null;
    labelRu: string;
  }>;
  stepChanges: Array<{ kind: 'ADDED' | 'REMOVED' | 'CHANGED'; order: number; labelRu: string; before?: string; after?: string }>;
};

function asObj(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function asArr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function qty(ing: IngredientLike): string {
  const q = ing.quantity ?? ing.amount ?? '';
  const unit = ing.unit ?? '';
  return `${q}${unit ? ` ${unit}` : ''}`.trim();
}

function pushScalar(
  sections: RecipeVersionDiffSection[],
  field: string,
  labelRu: string,
  before: unknown,
  after: unknown,
) {
  const same = JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
  sections.push({
    field,
    labelRu,
    before: before ?? null,
    after: after ?? null,
    changeKind: same ? 'UNCHANGED' : before == null || before === '' ? 'ADDED' : after == null || after === '' ? 'REMOVED' : 'CHANGED',
  });
}

export function diffRecipeVersions(input: {
  before: {
    contentSnapshotJson?: unknown;
    ingredientsSnapshotJson?: unknown;
    stepsSnapshotJson?: unknown;
    nutritionSnapshotJson?: unknown;
    restrictionSnapshotJson?: unknown;
    costSnapshotJson?: unknown;
    servings?: number | null;
  };
  after: {
    contentSnapshotJson?: unknown;
    ingredientsSnapshotJson?: unknown;
    stepsSnapshotJson?: unknown;
    nutritionSnapshotJson?: unknown;
    restrictionSnapshotJson?: unknown;
    costSnapshotJson?: unknown;
    servings?: number | null;
  };
}): RecipeVersionDiffResult {
  const beforeContent = asObj(input.before.contentSnapshotJson);
  const afterContent = asObj(input.after.contentSnapshotJson);
  const sections: RecipeVersionDiffSection[] = [];

  pushScalar(sections, 'title', 'Название', beforeContent.title ?? beforeContent.name, afterContent.title ?? afterContent.name);
  pushScalar(sections, 'description', 'Описание', beforeContent.description, afterContent.description);
  pushScalar(sections, 'servings', 'Порции', input.before.servings, input.after.servings);
  pushScalar(
    sections,
    'cooking',
    'Метаданные готовки',
    {
      prepMinutes: beforeContent.prepMinutes,
      cookMinutes: beforeContent.cookMinutes,
      cookingMethod: beforeContent.cookingMethod,
      equipment: beforeContent.equipment,
    },
    {
      prepMinutes: afterContent.prepMinutes,
      cookMinutes: afterContent.cookMinutes,
      cookingMethod: afterContent.cookingMethod,
      equipment: afterContent.equipment,
    },
  );

  const beforeNutrition = asObj(input.before.nutritionSnapshotJson);
  const afterNutrition = asObj(input.after.nutritionSnapshotJson);
  pushScalar(sections, 'nutrition', 'КБЖУ', beforeNutrition, afterNutrition);

  const beforeRest = asObj(input.before.restrictionSnapshotJson);
  const afterRest = asObj(input.after.restrictionSnapshotJson);
  pushScalar(
    sections,
    'restrictions',
    'Аллергены и диета',
    { allergens: beforeRest.allergens, dietaryTags: beforeRest.dietaryTags },
    { allergens: afterRest.allergens, dietaryTags: afterRest.dietaryTags },
  );

  pushScalar(sections, 'cost', 'Снимок стоимости', asObj(input.before.costSnapshotJson), asObj(input.after.costSnapshotJson));

  const beforeIngs = asArr<IngredientLike>(input.before.ingredientsSnapshotJson);
  const afterIngs = asArr<IngredientLike>(input.after.ingredientsSnapshotJson);
  const beforeByProduct = new Map(beforeIngs.map((i) => [String(i.productId ?? i.productName ?? ''), i]));
  const afterByProduct = new Map(afterIngs.map((i) => [String(i.productId ?? i.productName ?? ''), i]));
  const ingredientChanges: RecipeVersionDiffResult['ingredientChanges'] = [];

  for (const [key, afterIng] of afterByProduct) {
    const beforeIng = beforeByProduct.get(key);
    if (!beforeIng) {
      ingredientChanges.push({
        kind: 'ADDED',
        productId: afterIng.productId,
        productName: afterIng.productName,
        afterQuantity: qty(afterIng),
        labelRu: `Добавлен: ${afterIng.productName ?? afterIng.productId ?? 'продукт'}`,
      });
      continue;
    }
    if (qty(beforeIng) !== qty(afterIng)) {
      ingredientChanges.push({
        kind: 'QUANTITY_CHANGED',
        productId: afterIng.productId,
        productName: afterIng.productName,
        beforeQuantity: qty(beforeIng),
        afterQuantity: qty(afterIng),
        labelRu: `Количество изменено: ${afterIng.productName ?? key}`,
      });
    } else {
      ingredientChanges.push({
        kind: 'UNCHANGED',
        productId: afterIng.productId,
        productName: afterIng.productName,
        labelRu: `Без изменений: ${afterIng.productName ?? key}`,
      });
    }
  }
  for (const [key, beforeIng] of beforeByProduct) {
    if (afterByProduct.has(key)) continue;
    // product replaced detection: same position missing id match already handled as remove+add
    ingredientChanges.push({
      kind: 'REMOVED',
      productId: beforeIng.productId,
      productName: beforeIng.productName,
      beforeQuantity: qty(beforeIng),
      labelRu: `Удалён: ${beforeIng.productName ?? beforeIng.productId ?? 'продукт'}`,
    });
  }

  // Heuristic product replacement: one removed + one added
  const removed = ingredientChanges.filter((c) => c.kind === 'REMOVED');
  const added = ingredientChanges.filter((c) => c.kind === 'ADDED');
  if (removed.length === 1 && added.length === 1) {
    const r = removed[0]!;
    const a = added[0]!;
    ingredientChanges.push({
      kind: 'PRODUCT_REPLACED',
      beforeProductId: r.productId,
      afterProductId: a.productId,
      productName: a.productName,
      beforeQuantity: r.beforeQuantity,
      afterQuantity: a.afterQuantity,
      labelRu: `Product заменён: ${r.productName ?? r.productId} → ${a.productName ?? a.productId}`,
    });
  }

  const beforeSteps = asArr<StepLike>(input.before.stepsSnapshotJson);
  const afterSteps = asArr<StepLike>(input.after.stepsSnapshotJson);
  const maxSteps = Math.max(beforeSteps.length, afterSteps.length);
  const stepChanges: RecipeVersionDiffResult['stepChanges'] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const b = beforeSteps[i];
    const a = afterSteps[i];
    const bText = String(b?.text ?? b?.instruction ?? '');
    const aText = String(a?.text ?? a?.instruction ?? '');
    const order = Number(a?.order ?? a?.position ?? b?.order ?? b?.position ?? i + 1);
    if (!b && a) {
      stepChanges.push({ kind: 'ADDED', order, labelRu: `Шаг ${order} добавлен`, after: aText });
    } else if (b && !a) {
      stepChanges.push({ kind: 'REMOVED', order, labelRu: `Шаг ${order} удалён`, before: bText });
    } else if (bText !== aText) {
      stepChanges.push({ kind: 'CHANGED', order, labelRu: `Шаг ${order} изменён`, before: bText, after: aText });
    }
  }

  return { sections, ingredientChanges, stepChanges };
}
