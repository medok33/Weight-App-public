import type {
  CreatePlanRevisionInput,
  PlanKind,
  PlanRevision,
} from '../domain/revision-engine.types';
import type { RevisionEngineRepositoryPort } from './revision-engine.repository.port';

export class InMemoryRevisionEngineRepository implements RevisionEngineRepositoryPort {
  private readonly revisions: PlanRevision[] = [];

  async create(input: CreatePlanRevisionInput): Promise<PlanRevision> {
    if (input.status !== 'confirmed') throw new Error('REVISION_CONFIRMATION_REQUIRED');
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotency(input.userId, input.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== input.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
        return existing;
      }
    }

    const version =
      input.version > 0
        ? input.version
        : Math.max(
            0,
            ...this.revisions
              .filter((revision) => revision.planId === input.planId && revision.planKind === input.planKind)
              .map((revision) => revision.version),
          ) + 1;

    const duplicate = this.revisions.find(
      (revision) =>
        revision.planId === input.planId &&
        revision.planKind === input.planKind &&
        revision.version === version,
    );
    if (duplicate) throw new Error('REVISION_VERSION_CONFLICT');

    const revision: PlanRevision = {
      id: `mem-${this.revisions.length + 1}`,
      userId: input.userId,
      planId: input.planId,
      planKind: input.planKind,
      version,
      reason: input.reason,
      status: 'confirmed',
      snapshot: input.snapshot,
      idempotencyKey: input.idempotencyKey ?? null,
      requestHash: input.requestHash ?? null,
      createdAt: new Date().toISOString(),
    };
    this.revisions.push(Object.freeze(revision));
    return revision;
  }

  async findByIdempotency(userId: string, idempotencyKey: string): Promise<PlanRevision | null> {
    return this.revisions.find((revision) => revision.userId === userId && revision.idempotencyKey === idempotencyKey) ?? null;
  }

  async findById(userId: string, revisionId: string): Promise<PlanRevision | null> {
    return this.revisions.find((revision) => revision.id === revisionId && revision.userId === userId) ?? null;
  }

  async listByPlan(userId: string, planId: string, planKind: PlanKind): Promise<PlanRevision[]> {
    return this.revisions
      .filter((revision) => revision.userId === userId && revision.planId === planId && revision.planKind === planKind)
      .sort((left, right) => left.version - right.version);
  }

  async findLatestByPlan(userId: string, planId: string, planKind: PlanKind): Promise<PlanRevision | null> {
    const revisions = await this.listByPlan(userId, planId, planKind);
    return revisions[revisions.length - 1] ?? null;
  }
}
