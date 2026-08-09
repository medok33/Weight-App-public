import { describe, expect, it } from 'vitest';
import { buildPdfLines, buildPlanExportDocument, renderMealPlanPdf } from '../domain/plan-pdf.renderer';
import { assertShareLinkActive } from '../domain/share.policy';
import { createSignedDownload, verifySignedDownload } from '../domain/signed-download.policy';
import type { ShareLinkRecord } from '../domain/export-document.types';

describe('STEP_148 export/share privacy', () => {
  it('PDF document lines never include internal ids or technical keys', async () => {
    const doc = buildPlanExportDocument({
      locale: 'ru',
      displayName: 'Мария',
      version: 1,
      targetKcal: 1600,
      days: [{ dayIndex: 0, mealName: 'greek_yogurt', calories: 200, proteinG: 15 }],
    });
    const blob = (await renderMealPlanPdf(doc)).toString('latin1');
    const lines = buildPdfLines(doc).join('\n');
    for (const banned of ['userId', 'recipeId', 'planId', 'productId', 'retailerCode', 'idempotencyKey']) {
      expect(lines).not.toContain(banned);
      expect(blob.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('rejects forged or expired download signatures', () => {
    const signed = createSignedDownload('u1/j1/meal-plan.pdf', 60, 'secret');
    expect(() => verifySignedDownload(signed.storageKey, signed.expiresAt, 'forged', 'secret')).toThrow(
      'EXPORT_DOWNLOAD_FORBIDDEN',
    );
    expect(() => verifySignedDownload(signed.storageKey, Math.floor(Date.now() / 1000) - 10, signed.signature, 'secret')).toThrow(
      'EXPORT_DOWNLOAD_EXPIRED',
    );
  });

  it('blocks revoked and expired share links', () => {
    const base: ShareLinkRecord = {
      id: 's1',
      token: 'tok',
      exportJobId: 'j1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };
    expect(() => assertShareLinkActive(base)).not.toThrow();
    expect(() => assertShareLinkActive({ ...base, revokedAt: new Date().toISOString() })).toThrow('SHARE_LINK_REVOKED');
    expect(() =>
      assertShareLinkActive({ ...base, expiresAt: new Date(Date.now() - 1000).toISOString() }),
    ).toThrow('SHARE_LINK_EXPIRED');
  });
});
