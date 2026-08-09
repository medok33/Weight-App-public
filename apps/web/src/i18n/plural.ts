import { DEFAULT_BCP47, toBcp47, type UiLocaleCode } from './locale';

type RuPluralCategory = 'one' | 'few' | 'many' | 'other';

function ruCategory(n: number): RuPluralCategory {
  const rules = new Intl.PluralRules('ru-RU');
  const cat = rules.select(Math.abs(n));
  if (cat === 'one' || cat === 'few' || cat === 'many') return cat;
  return 'other';
}

const FORMS = {
  recipe: { one: 'рецепт', few: 'рецепта', many: 'рецептов', other: 'рецептов' },
  product: { one: 'продукт', few: 'продукта', many: 'продуктов', other: 'продуктов' },
  minute: { one: 'минута', few: 'минуты', many: 'минут', other: 'минут' },
  hour: { one: 'час', few: 'часа', many: 'часов', other: 'часов' },
  day: { one: 'день', few: 'дня', many: 'дней', other: 'дней' },
  item: { one: 'позиция', few: 'позиции', many: 'позиций', other: 'позиций' },
  occurrence: {
    one: 'срабатывание',
    few: 'срабатывания',
    many: 'срабатываний',
    other: 'срабатываний',
  },
} as const;

export type PluralUnit = keyof typeof FORMS;

/** «1 рецепт», «2 рецепта», «5 рецептов», «21 продукт»… */
export function formatCountUnit(
  count: number,
  unit: PluralUnit,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  const n = Math.round(count);
  if (!toBcp47(locale).startsWith('ru')) {
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
  }
  const form = FORMS[unit][ruCategory(n)];
  return `${n} ${form}`;
}

export function pluralizeUnit(
  count: number,
  unit: PluralUnit,
  locale: UiLocaleCode | string = DEFAULT_BCP47,
): string {
  const n = Math.round(count);
  if (!toBcp47(locale).startsWith('ru')) {
    return `${unit}${n === 1 ? '' : 's'}`;
  }
  return FORMS[unit][ruCategory(n)];
}
