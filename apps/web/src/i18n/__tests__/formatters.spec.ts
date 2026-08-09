import { describe, expect, it } from 'vitest';
import {
  formatCurrencyRub,
  formatDate,
  formatDecimal,
  formatDurationMinutes,
  formatEnergyKcal,
  formatInteger,
  formatMassGrams,
  formatPercent,
  formatRelativeDay,
  formatVolumeMl,
} from '../formatters';
import { formatCountUnit } from '../plural';
import { formatCoverageSlotTitle, labelDataClass, labelLifecycleStatus } from '../enums';

describe('UI-RU-01 formatters', () => {
  it('formats numbers and currency for ru-RU', () => {
    expect(formatInteger(1250, 'ru')).toMatch(/1[\s\u00a0]250/);
    expect(formatDecimal(12.5, 'ru')).toBe('12,5');
    expect(formatCurrencyRub(5565, 'ru')).toMatch(/5[\s\u00a0]565/);
    expect(formatCurrencyRub(120.5, 'ru')).toMatch(/120,50/);
  });

  it('formats dates without US order', () => {
    const d = new Date(2026, 6, 26, 14, 35);
    expect(formatDate(d, 'ru')).toMatch(/26\.07\.2026/);
    expect(formatRelativeDay(new Date(), 'ru')).toBe('сегодня');
  });

  it('formats mass, volume, energy, percent, duration', () => {
    expect(formatMassGrams(250, 'ru')).toBe('250 г');
    expect(formatMassGrams(1500, 'ru')).toMatch(/1,5 кг/);
    expect(formatVolumeMl(200, 'ru')).toBe('200 мл');
    expect(formatEnergyKcal(485, 'ru')).toBe('485 ккал');
    expect(formatPercent(12.5, 'ru')).toBe('12,5 %');
    expect(formatDurationMinutes(35, 'ru')).toBe('35 минут');
    expect(formatDurationMinutes(80, 'ru')).toBe('1 час 20 минут');
  });

  it('pluralizes Russian counts', () => {
    expect(formatCountUnit(1, 'recipe')).toBe('1 рецепт');
    expect(formatCountUnit(2, 'recipe')).toBe('2 рецепта');
    expect(formatCountUnit(5, 'recipe')).toBe('5 рецептов');
    expect(formatCountUnit(21, 'product')).toBe('21 продукт');
    expect(formatCountUnit(22, 'product')).toBe('22 продукта');
    expect(formatCountUnit(25, 'product')).toBe('25 продуктов');
  });

  it('maps enums and coverage titles without raw codes', () => {
    expect(labelLifecycleStatus('PUBLISHED')).toBe('Опубликована');
    expect(labelDataClass('PRODUCTION')).toBe('Рабочий рецепт');
    expect(
      formatCoverageSlotTitle({
        mealType: 'lunch',
        primaryProductName: 'курица',
        dishType: 'MAIN',
        cookingMethod: 'STOVE',
      }),
    ).toBe('Обед: курица, основное блюдо на плите');
    expect(formatCoverageSlotTitle({ mealType: 'breakfast', dishType: 'PORRIDGE' })).toBe('Завтрак: каша');
  });
});
