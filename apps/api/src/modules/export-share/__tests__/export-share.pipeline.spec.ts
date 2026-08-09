import { describe, expect, it } from 'vitest';
import {
  buildPdfLines,
  buildPlanExportDocument,
  renderMealPlanPdf,
  resolveNotoSansPath,
} from '../domain/plan-pdf.renderer';
import { createSignedDownload, verifySignedDownload } from '../domain/signed-download.policy';
import { buildShareAdapterUrl, validateShareTtlMinutes } from '../domain/share.policy';
import { buildShoppingPrintDocument, renderShoppingListHtml } from '../domain/shopping-print.renderer';

describe('STEP_142 plan PDF renderer (Unicode font)', () => {
  it('embeds Noto Sans and renders Cyrillic strings', async () => {
    expect(resolveNotoSansPath()).toContain('NotoSans-Regular.ttf');
    const doc = buildPlanExportDocument({
      locale: 'ru',
      displayName: 'Анна Иванова',
      version: 2,
      targetKcal: 1800,
      days: [
        { dayIndex: 0, mealName: 'greek_yogurt', calories: 220, proteinG: 18 },
        { dayIndex: 1, mealName: 'protein_plate', calories: 520, proteinG: 42 },
      ],
    });
    const lines = buildPdfLines(doc);
    expect(lines.join('\n')).toContain('План питания');
    expect(lines.join('\n')).toContain('Белковая тарелка');
    expect(lines.join('\n')).toContain('Греческий йогурт');
    expect(lines.join('\n')).toContain('Цель пользователя');
    expect(lines.join('\n')).toContain('Анна Иванова');
    expect(lines.join('\n')).toContain('₽');
    const pdf = await renderMealPlanPdf(doc);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text).toContain('/Font');
    expect(text.toLowerCase()).not.toContain('helvetica');
    expect(pdf.byteLength).toBeGreaterThan(5_000);
    expect(text).toMatch(/FontFile2?/);
  });

  it('handles empty plan without crashing', async () => {
    const doc = buildPlanExportDocument({ locale: 'en', displayName: null, version: null, targetKcal: null, days: [] });
    expect((await renderMealPlanPdf(doc)).byteLength).toBeGreaterThan(1000);
  });
});

describe('STEP_143 shopping print', () => {
  it('builds printable HTML without productId', () => {
    const doc = buildShoppingPrintDocument({
      locale: 'en',
      items: [{ name: 'Milk', quantity: 1, unit: 'l', estimatedCost: 90 }],
      weekCost: 90,
      currency: 'RUB',
    });
    const html = renderShoppingListHtml(doc);
    expect(html).toContain('Shopping list');
    expect(html).toContain('Milk');
    expect(html).not.toContain('productId');
  });
});

describe('STEP_144 signed download', () => {
  it('signs and verifies download tokens', () => {
    const signed = createSignedDownload('u1/j1/meal-plan.pdf', 600, 'secret');
    expect(signed.path).toContain('/export-share/download?');
    expect(() => verifySignedDownload(signed.storageKey, signed.expiresAt, signed.signature, 'secret')).not.toThrow();
    expect(() => verifySignedDownload(signed.storageKey, signed.expiresAt, 'bad', 'secret')).toThrow(
      'EXPORT_DOWNLOAD_FORBIDDEN',
    );
  });
});

describe('STEP_145/146 share link + adapters', () => {
  it('validates TTL and builds messenger adapters', () => {
    expect(validateShareTtlMinutes(60)).toBe(60);
    expect(() => validateShareTtlMinutes(1)).toThrow('SHARE_TTL_INVALID');
    const tg = buildShareAdapterUrl('telegram', 'https://app.test/export-share/download?x=1', 'Plan');
    expect(tg.url).toContain('t.me/share');
    expect(buildShareAdapterUrl('email', 'https://app.test/x', 'Plan').url.startsWith('mailto:')).toBe(true);
  });
});
