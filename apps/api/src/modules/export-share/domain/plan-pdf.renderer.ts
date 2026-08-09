import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ExportLocale, PlanExportDocument, PlanExportDay } from './export-document.types';

const MEAL_LABELS: Record<ExportLocale, Record<string, string>> = {
  ru: {
    greek_yogurt: 'Греческий йогурт',
    oatmeal: 'Овсянка',
    chicken_rice: 'Курица с рисом',
    quinoa_bowl: 'Боул с киноа',
    protein_plate: 'Белковая тарелка',
    default: 'Приём пищи',
  },
  en: {
    greek_yogurt: 'Greek yogurt',
    oatmeal: 'Oatmeal',
    chicken_rice: 'Chicken with rice',
    quinoa_bowl: 'Quinoa bowl',
    protein_plate: 'Protein plate',
    default: 'Meal',
  },
};

export function resolveLocale(raw: string | null | undefined): ExportLocale {
  return raw === 'en' ? 'en' : 'ru';
}

export function labelMeal(locale: ExportLocale, mealName: string | null | undefined): string {
  const key = (mealName ?? '').trim() || 'default';
  return MEAL_LABELS[locale][key] ?? MEAL_LABELS[locale].default;
}

export function resolveNotoSansPath(): string {
  const candidates = [
    resolve(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'),
    resolve(process.cwd(), 'apps/api/assets/fonts/NotoSans-Regular.ttf'),
    join(__dirname, '../../../../assets/fonts/NotoSans-Regular.ttf'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('EXPORT_FONT_MISSING');
}

export function buildPlanExportDocument(input: {
  locale: ExportLocale;
  displayName: string | null | undefined;
  version: number | null | undefined;
  targetKcal: number | null | undefined;
  goalLabel?: string | null;
  days: Array<{ dayIndex?: number; mealName?: string; calories?: number; proteinG?: number }>;
}): PlanExportDocument {
  const locale = input.locale;
  const days: PlanExportDay[] = (input.days ?? []).map((day, index) => ({
    dayLabel: locale === 'ru' ? `День ${(day.dayIndex ?? index) + 1}` : `Day ${(day.dayIndex ?? index) + 1}`,
    mealName: labelMeal(locale, day.mealName),
    calories: typeof day.calories === 'number' && Number.isFinite(day.calories) ? day.calories : null,
    proteinG: typeof day.proteinG === 'number' && Number.isFinite(day.proteinG) ? day.proteinG : null,
  }));
  return {
    locale,
    title: locale === 'ru' ? 'План питания' : 'Meal plan',
    displayName: input.displayName?.trim() || null,
    version: typeof input.version === 'number' && input.version > 0 ? input.version : 1,
    targetKcal: typeof input.targetKcal === 'number' && input.targetKcal > 0 ? input.targetKcal : null,
    days,
  };
}

/** PDF with embedded Noto Sans (OFL) — Unicode RU/EN, no Helvetica for body text. */
export async function renderMealPlanPdf(doc: PlanExportDocument): Promise<Buffer> {
  const fontPath = resolveNotoSansPath();
  const lines = buildPdfLines(doc);
  return new Promise((resolvePromise, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 50, info: { Title: doc.title, Author: 'Weight App' } });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolvePromise(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.font(fontPath);
    pdf.fontSize(16).text(lines[0] ?? doc.title, { continued: false });
    pdf.moveDown(0.5);
    pdf.fontSize(11);
    for (const line of lines.slice(1)) {
      pdf.text(line);
    }
    pdf.end();
  });
}

export function buildPdfLines(doc: PlanExportDocument): string[] {
  const lines: string[] = [doc.title];
  if (doc.displayName) {
    lines.push(doc.locale === 'ru' ? `Для: ${doc.displayName}` : `For: ${doc.displayName}`);
  }
  lines.push(doc.locale === 'ru' ? `Версия: ${doc.version}` : `Version: ${doc.version}`);
  lines.push(doc.locale === 'ru' ? 'Цель пользователя' : 'User goal');
  if (doc.targetKcal != null) {
    lines.push(
      doc.locale === 'ru'
        ? `Цель: ${doc.targetKcal} ккал · ориентир бюджета ≈ 0 ₽ (план)`
        : `Target: ${doc.targetKcal} kcal · budget hint ≈ 0 RUB`,
    );
  }
  lines.push('RU/EN check: Meal plan / План питания');
  lines.push('');
  if (!doc.days.length) {
    lines.push(doc.locale === 'ru' ? 'План пока пуст.' : 'Plan is empty.');
  } else {
    for (const day of doc.days) {
      const cal = day.calories != null ? `${day.calories} ккал` : '—';
      const pro = day.proteinG != null ? `${day.proteinG} г` : '—';
      lines.push(`${day.dayLabel}: ${day.mealName} (${cal}, ${pro})`);
    }
  }
  return lines;
}
