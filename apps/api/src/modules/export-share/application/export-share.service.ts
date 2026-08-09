import { Inject, Injectable, Optional } from '@nestjs/common';
import { MealPlanService } from '../../meal-plan/application/meal-plan.service';
import { ShoppingListService } from '../../shopping-list/application/shopping-list.service';
import { UserProfileService } from '../../user-profile/application/user-profile.service';
import { buildPlanExportDocument, renderMealPlanPdf, resolveLocale } from '../domain/plan-pdf.renderer';
import { buildShoppingPrintDocument, renderShoppingListHtml } from '../domain/shopping-print.renderer';
import { createSignedDownload, verifySignedDownload } from '../domain/signed-download.policy';
import {
  assertShareLinkActive,
  buildShareAdapterUrl,
  validateShareTtlMinutes,
} from '../domain/share.policy';
import type { ExportJobType } from '../domain/export-share.types';
import type { ShareChannel } from '../domain/export-document.types';
import { ExportShareRepository } from '../infrastructure/export-share.repository';
import { LocalObjectStorage } from '../infrastructure/local-object-storage';

@Injectable()
export class ExportShareService {
  constructor(
    @Inject(ExportShareRepository) private readonly repository: ExportShareRepository,
    @Inject(LocalObjectStorage) private readonly storage: LocalObjectStorage,
    @Optional() @Inject(MealPlanService) private readonly mealPlan?: MealPlanService,
    @Optional() @Inject(ShoppingListService) private readonly shopping?: ShoppingListService,
    @Optional() @Inject(UserProfileService) private readonly profiles?: UserProfileService,
  ) {}

  async createExport(userId: string, type: ExportJobType, idempotencyKey: string) {
    const existing = await this.repository.findByIdempotency(idempotencyKey);
    if (existing) {
      if (existing.userId !== userId) throw new Error('EXPORT_FORBIDDEN');
      return existing;
    }
    const job = await this.repository.enqueue({
      userId,
      type,
      status: 'queued',
      idempotencyKey,
      payload: { type },
    });
    return this.processJob(job.id, userId);
  }

  async getJob(userId: string, jobId: string) {
    return this.repository.findByIdForUser(jobId, userId);
  }

  async listJobs(userId: string) {
    return this.repository.listForUser(userId);
  }

  listDocumentCatalog() {
    return [
      { type: 'meal_plan_pdf' as const, title: 'Meal plan PDF', titleRu: 'План питания (PDF)' },
      { type: 'shopping_list_print' as const, title: 'Shopping list print', titleRu: 'Список покупок (печать)' },
    ];
  }

  async processJob(jobId: string, userId: string) {
    let job = await this.repository.findByIdForUser(jobId, userId);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed') return job;
    try {
      job = await this.repository.transition(jobId, userId, 'running');
      if (job.type === 'meal_plan_pdf') {
        const stored = await this.renderPlanPdf(userId, jobId);
        return this.repository.transition(jobId, userId, 'succeeded', {
          result: { ...stored, kind: 'meal_plan_pdf' },
          errorCode: null,
        });
      }
      if (job.type === 'shopping_list_print') {
        const stored = await this.renderShoppingPrint(userId, jobId);
        return this.repository.transition(jobId, userId, 'succeeded', {
          result: { ...stored, kind: 'shopping_list_print' },
          errorCode: null,
        });
      }
      throw new Error('EXPORT_TYPE_UNSUPPORTED');
    } catch (error) {
      const code = error instanceof Error ? error.message : 'EXPORT_FAILED';
      return this.repository.transition(jobId, userId, 'failed', { errorCode: code });
    }
  }

  async signedDownloadForJob(userId: string, jobId: string, ttlSeconds = 600) {
    const job = await this.repository.findByIdForUser(jobId, userId);
    if (job.status !== 'succeeded') throw new Error('EXPORT_NOT_READY');
    const storageKey = String(job.result?.storageKey ?? '');
    if (!storageKey) throw new Error('EXPORT_STORAGE_MISSING');
    return createSignedDownload(storageKey, ttlSeconds, this.signingSecret());
  }

  async downloadBySignature(storageKey: string, expiresAt: number, signature: string) {
    verifySignedDownload(storageKey, expiresAt, signature, this.signingSecret());
    return this.storage.get(storageKey);
  }

  async createShareLink(userId: string, jobId: string, ttlMinutes: number) {
    const job = await this.repository.findByIdForUser(jobId, userId);
    if (job.status !== 'succeeded') throw new Error('EXPORT_NOT_READY');
    const ttl = validateShareTtlMinutes(ttlMinutes);
    return this.repository.createShareLink({ userId, exportJobId: jobId, ttlMinutes: ttl });
  }

  async revokeShareLink(userId: string, linkId: string) {
    return this.repository.revokeShareLink(linkId, userId);
  }

  async resolveShareAdapters(userId: string, jobId: string, publicBaseUrl: string) {
    const signed = await this.signedDownloadForJob(userId, jobId, 3600);
    const publicUrl = `${publicBaseUrl.replace(/\/$/, '')}${signed.path}`;
    const job = await this.repository.findByIdForUser(jobId, userId);
    const title = job.type === 'meal_plan_pdf' ? 'Meal plan export' : 'Shopping list export';
    const channels: ShareChannel[] = ['telegram', 'vk', 'whatsapp', 'email'];
    return channels.map((channel) => buildShareAdapterUrl(channel, publicUrl, title));
  }

  async publicSharePreview(token: string) {
    const link = await this.repository.findShareLinkByToken(token);
    if (!link) throw new Error('SHARE_LINK_NOT_FOUND');
    assertShareLinkActive(link);
    const job = await this.repository.findByIdForUser(link.exportJobId, link.userId);
    if (job.status !== 'succeeded') throw new Error('EXPORT_NOT_READY');
    const storageKey = String(job.result?.storageKey ?? '');
    return createSignedDownload(storageKey, 300, this.signingSecret());
  }

  shoppingPrintHtmlPreview(userId: string) {
    return this.renderShoppingPrintHtmlOnly(userId);
  }

  private async renderPlanPdf(userId: string, jobId: string) {
    if (!this.mealPlan) throw new Error('EXPORT_MEAL_PLAN_UNAVAILABLE');
    const [summary, profile] = await Promise.all([
      this.mealPlan.getSummary(userId),
      this.profiles?.getProfile(userId),
    ]);
    const doc = buildPlanExportDocument({
      locale: resolveLocale(profile?.locale),
      displayName: profile?.displayName,
      version: summary.version,
      targetKcal: summary.targetKcal ?? null,
      days: summary.days,
    });
    const pdf = await renderMealPlanPdf(doc);
    return this.storage.put(userId, jobId, 'meal-plan.pdf', pdf, 'application/pdf');
  }

  private async renderShoppingPrint(userId: string, jobId: string) {
    const html = await this.renderShoppingPrintHtmlOnly(userId);
    return this.storage.put(userId, jobId, 'shopping-list.html', Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
  }

  private async renderShoppingPrintHtmlOnly(userId: string) {
    if (!this.shopping) throw new Error('EXPORT_SHOPPING_UNAVAILABLE');
    const [list, profile] = await Promise.all([
      this.shopping.getLatest(userId),
      this.profiles?.getProfile(userId),
    ]);
    const doc = buildShoppingPrintDocument({
      locale: resolveLocale(profile?.locale),
      items: list?.items ?? [],
      weekCost: list?.estimatedTotal ?? null,
      currency: 'RUB',
    });
    return renderShoppingListHtml(doc);
  }

  private signingSecret() {
    return process.env.EXPORT_SIGNING_SECRET?.trim() || process.env.PAYMENT_WEBHOOK_SECRET || 'local-export-secret';
  }
}
