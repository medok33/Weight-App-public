import { describe, expect, it } from 'vitest';
import { ExportShareService } from '../application/export-share.service';
import type { ExportJobDraft, ExportJobRecord, ExportJobStatus } from '../domain/export-share.types';
import { LocalObjectStorage } from '../infrastructure/local-object-storage';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type JobRow = ExportJobRecord;

describe('ExportShareService orchestration', () => {
  it('runs meal_plan_pdf job to succeeded with stored object', async () => {
    const root = mkdtempSync(join(tmpdir(), 'export-share-'));
    process.env.EXPORT_STORAGE_ROOT = root;
    const storage = new LocalObjectStorage();
    const jobs = new Map<string, JobRow>();
    const repository = {
      findByIdempotency: async (key: string) => [...jobs.values()].find((j) => j.idempotencyKey === key),
      enqueue: async (draft: ExportJobDraft) => {
        const row: JobRow = {
          id: 'job-1',
          ...draft,
          result: null,
          errorCode: null,
        };
        jobs.set(row.id, row);
        return row;
      },
      findByIdForUser: async (id: string, userId: string) => {
        const row = jobs.get(id);
        if (!row || row.userId !== userId) throw new Error('EXPORT_JOB_NOT_FOUND');
        return row;
      },
      transition: async (
        id: string,
        userId: string,
        next: ExportJobStatus,
        patch?: { result?: JobRow['result']; errorCode?: string | null },
      ) => {
        const row = await repository.findByIdForUser(id, userId);
        row.status = next;
        if (patch?.result) row.result = patch.result;
        if (patch && 'errorCode' in patch) row.errorCode = patch.errorCode ?? null;
        return row;
      },
    };
    const mealPlan = {
      getSummary: async () => ({
        version: 1,
        targetKcal: 1700,
        days: [{ dayIndex: 0, mealName: 'oatmeal', calories: 400, proteinG: 15 }],
      }),
    };
    const profiles = { getProfile: async () => ({ displayName: 'Test', locale: 'en' }) };
    const service = new ExportShareService(
      repository as never,
      storage,
      mealPlan as never,
      undefined,
      profiles as never,
    );
    const job = await service.createExport('user-1', 'meal_plan_pdf', 'export-pdf-001');
    expect(job.status).toBe('succeeded');
    expect(job.result?.storageKey).toContain('meal-plan.pdf');
    const again = await service.createExport('user-1', 'meal_plan_pdf', 'export-pdf-001');
    expect(again.id).toBe(job.id);
  });

  it('marks job failed when meal plan dependency missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'export-share-'));
    process.env.EXPORT_STORAGE_ROOT = root;
    const storage = new LocalObjectStorage();
    const jobs = new Map<string, JobRow>();
    const repository = {
      findByIdempotency: async () => undefined,
      enqueue: async (draft: ExportJobDraft) => {
        const row: JobRow = {
          id: 'job-2',
          ...draft,
          result: null,
          errorCode: null,
        };
        jobs.set(row.id, row);
        return row;
      },
      findByIdForUser: async (id: string) => jobs.get(id),
      transition: async (
        id: string,
        _userId: string,
        next: ExportJobStatus,
        patch?: { errorCode?: string | null },
      ) => {
        const row = jobs.get(id)!;
        row.status = next;
        if (patch?.errorCode) row.errorCode = patch.errorCode;
        return row;
      },
    };
    const service = new ExportShareService(repository as never, storage, undefined, undefined, undefined);
    const job = await service.createExport('user-1', 'meal_plan_pdf', 'export-pdf-fail');
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('EXPORT_MEAL_PLAN_UNAVAILABLE');
  });
});

