import type { CreatePlanRevisionInput, PlanKind, PlanRevision } from '../domain/revision-engine.types';

export interface RevisionEngineRepositoryPort {
  create(input: CreatePlanRevisionInput): Promise<PlanRevision>;
  findById(userId: string, revisionId: string): Promise<PlanRevision | null>;
  listByPlan(userId: string, planId: string, planKind: PlanKind): Promise<PlanRevision[]>;
  findLatestByPlan(userId: string, planId: string, planKind: PlanKind): Promise<PlanRevision | null>;
  findByIdempotency(userId: string, idempotencyKey: string): Promise<PlanRevision | null>;
}
