import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService, type SqlQuery } from '../../../infrastructure/database/prisma.service';
import { canPublish, publicationChecksum, type AuthoringIngredient, type AuthoringStep, type CookTest, type HumanReview, type RecipeNutrition } from '../domain/recipe-authoring.policy';
import { qualityContractChecksum, type RecipeQualityReceipt } from '../domain/recipe-quality.receipt';
import { isVerifiedQualityReceipt } from './recipe-quality.orchestrator';
import type { RecipeContractV1 } from '../domain/recipe-contract.v1';

export type PublicationInput = { recipeKey: string; title: string; description: string; servings: number; yieldGrams: number; ingredients: AuthoringIngredient[]; steps: AuthoringStep[]; nutrition: RecipeNutrition; cost: unknown; similarityAutoPublish?: boolean; editorial?: HumanReview; cookTest?: CookTest; actorId: string; provenance?: Record<string, unknown>; qualityContract: RecipeContractV1; qualityReceipt: RecipeQualityReceipt };

export type StageDraftResult = {
  recipeId: string;
  recipeVersionId: string;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED';
  lifecycleStatus: 'IN_REVIEW' | 'PUBLISHED';
  idempotent: boolean;
};

/**
 * Single shared publication-parity validator. stageDraft() and publish() must
 * never drift into two independent gate implementations (07C2A-R2 defect class).
 */
export function assertReceiptMatchesPublication(input: PublicationInput): void {
  if (!isVerifiedQualityReceipt(input.qualityReceipt, input.qualityContract)) throw new Error('PUBLICATION_QUALITY_RECEIPT_REQUIRED');
  if (input.qualityReceipt.critic.verdict !== 'PASS') throw new Error('PUBLICATION_CRITIC_PASS_REQUIRED');
  if (qualityContractChecksum(input.qualityContract) !== input.qualityReceipt.contractChecksum) throw new Error('PUBLICATION_QUALITY_RECEIPT_MISMATCH');
  const contract = input.qualityContract;
  if (contract.recipeKey !== input.recipeKey || contract.title !== input.title || contract.description !== input.description || contract.servings !== input.servings || contract.yieldGrams !== input.yieldGrams) throw new Error('PUBLICATION_CANONICAL_CONTRACT_MISMATCH');
  if (contract.ingredients.length !== input.ingredients.length || contract.ingredients.some((line, index) => line.productId !== input.ingredients[index]?.productId || line.grams !== input.ingredients[index]?.amount || line.unit !== input.ingredients[index]?.unit)) throw new Error('PUBLICATION_INGREDIENT_CONTRACT_MISMATCH');
}

type VersionRow = { id: string; recipeId: string; versionNumber: number; status: string };

@Injectable()
export class RecipePublicationService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  /**
   * Canonical verified-draft boundary. Persists an immutable DRAFT snapshot for
   * editorial review without touching current publication state:
   * - requires the same verified quality receipt + contract parity as publish();
   * - creates the Recipe shell only when absent (never mutates shell metadata);
   * - stages RecipeVersion status=DRAFT with lifecycle IN_REVIEW/VALID;
   * - leaves approvedBy/approvedAt/publishedAt NULL and currentVersionId untouched.
   *
   * Idempotency: replay of the same content checksum returns the same version.
   * Staging content that is already PUBLISHED returns that version unchanged
   * (a DRAFT may replay as DRAFT; staging may never resurrect a publication).
   */
  async stageDraft(input: PublicationInput): Promise<StageDraftResult> {
    assertReceiptMatchesPublication(input);
    if (input.qualityContract.publicationState !== 'DRAFT') throw new Error('DRAFT_PUBLICATION_STATE_REQUIRED');
    const checksum = publicationChecksum({ recipeKey: input.recipeKey, title: input.title, servings: input.servings, yieldGrams: input.yieldGrams, ingredients: input.ingredients, steps: input.steps, nutrition: input.nutrition, cost: input.cost });
    return this.db.withTransaction(async (query) => {
      // Serialize all replays of one immutable artifact before inspecting the
      // checksum. This is database-scoped (not a process mutex), so concurrent
      // callers have a real lock boundary and the UNIQUE checksum remains the
      // final authority.
      const lockKey = Number.parseInt(createHash('sha256').update(`recipe-artifact:${checksum}`).digest('hex').slice(0, 8), 16) & 0x7fffffff;
      await query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
      const existing = await query<VersionRow>(`SELECT id,"recipeId","versionNumber",status FROM "RecipeVersion" WHERE checksum=$1 LIMIT 1`, [checksum]);
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.status === 'PUBLISHED') {
          return { recipeId: row.recipeId, recipeVersionId: row.id, versionNumber: row.versionNumber, status: 'PUBLISHED', lifecycleStatus: 'PUBLISHED', idempotent: true };
        }
        await this.ensureDraftLifecycle(query, row.id, input.actorId);
        return { recipeId: row.recipeId, recipeVersionId: row.id, versionNumber: row.versionNumber, status: 'DRAFT', lifecycleStatus: 'IN_REVIEW', idempotent: true };
      }

      // Shell upsert is create-only: staging a DRAFT must never rewrite
      // user-visible Recipe metadata of an existing shell (07C2A defect 3).
      const inserted = await query<{ id: string }>(
        `INSERT INTO "Recipe" (name,servings,description,"portionGrams","recipeKey","dataClass")
         VALUES ($1,$2,$3,$4,$5,'TEST_ONLY')
         ON CONFLICT ("recipeKey") DO NOTHING
         RETURNING id`,
        [input.title, input.servings, input.description, input.yieldGrams / input.servings, input.recipeKey],
      );
      let recipeId = inserted.rows[0]?.id;
      if (!recipeId) {
        const shell = await query<{ id: string }>(`SELECT id FROM "Recipe" WHERE "recipeKey"=$1 LIMIT 1`, [input.recipeKey]);
        if (!shell.rows[0]) throw new Error('RECIPE_CREATE_FAILED');
        recipeId = shell.rows[0].id;
      }
      await query(`SELECT id FROM "Recipe" WHERE id=$1 FOR UPDATE`, [recipeId]);

      const next = await query<{ n: number }>(`SELECT COALESCE(MAX("versionNumber"),0)+1 AS n FROM "RecipeVersion" WHERE "recipeId"=$1`, [recipeId]);
      const versionNumber = Number(next.rows[0]?.n ?? 1);
      const parent = await query<{ id: string }>(`SELECT id FROM "RecipeVersion" WHERE "recipeId"=$1 ORDER BY "versionNumber" DESC LIMIT 1`, [recipeId]);
      const version = await query<{ id: string }>(
        `INSERT INTO "RecipeVersion" (
           "recipeId","versionNumber",status,
           "contentSnapshotJson","ingredientsSnapshotJson","stepsSnapshotJson",
           "nutritionSnapshotJson","costSnapshotJson","restrictionSnapshotJson",
           servings,"servingWeightGrams","changeType","createdBy",
           "approvedBy","approvedAt","publishedAt",
           checksum,"parentVersionId",provenance
         ) VALUES (
           $1,$2,'DRAFT',
           $3::jsonb,$4::jsonb,$5::jsonb,
           $6::jsonb,$7::jsonb,'{}'::jsonb,
           $8,$9,'SYSTEM',$10,
           NULL,NULL,NULL,
           $11,$12,'SYSTEM'
         )
         ON CONFLICT (checksum) DO NOTHING
         RETURNING id`,
        [recipeId, versionNumber, JSON.stringify({ title: input.title, description: input.description, servings: input.servings, publicationState: 'DRAFT', automatedQualityPass: true, provenance: input.provenance ?? null }), JSON.stringify(input.ingredients), JSON.stringify(input.steps), JSON.stringify(input.nutrition), JSON.stringify(input.cost), input.servings, input.yieldGrams / input.servings, input.actorId, checksum, parent.rows[0]?.id ?? null],
      );
      if (!version.rows[0]) {
        const replay = await query<VersionRow>(`SELECT id,"recipeId","versionNumber",status FROM "RecipeVersion" WHERE checksum=$1 LIMIT 1`, [checksum]);
        if (!replay.rows[0]) throw new Error('VERSION_CREATE_FAILED');
        await this.ensureDraftLifecycle(query, replay.rows[0].id, input.actorId);
        return { recipeId: replay.rows[0].recipeId, recipeVersionId: replay.rows[0].id, versionNumber: replay.rows[0].versionNumber, status: 'DRAFT', lifecycleStatus: 'IN_REVIEW', idempotent: true };
      }
      const versionId = version.rows[0].id;
      await this.ensureDraftLifecycle(query, versionId, input.actorId, true);
      return { recipeId, recipeVersionId: versionId, versionNumber, status: 'DRAFT', lifecycleStatus: 'IN_REVIEW', idempotent: false };
    });
  }

  /**
   * Publish the verified artifact. A replay of already-published content is a
   * true idempotent success; a matching verified DRAFT is promoted atomically
   * through the same publication gates (never mistaken for a completed publish).
   */
  async publish(input: PublicationInput) {
    assertReceiptMatchesPublication(input);
    const gate = canPublish({ editorial: input.editorial, cookTest: input.cookTest, automatedQualityPass: true, validationPass: true, costStatus: (input.cost as { status?: 'PASS'|'UNAVAILABLE' })?.status ?? 'UNAVAILABLE', similarityAutoPublish: input.similarityAutoPublish });
    if (!gate.ok) throw new Error(`PUBLICATION_BLOCKED:${gate.reasons.join(',')}`);
    const checksum = publicationChecksum({ recipeKey: input.recipeKey, title: input.title, servings: input.servings, yieldGrams: input.yieldGrams, ingredients: input.ingredients, steps: input.steps, nutrition: input.nutrition, cost: input.cost });
    return this.db.withTransaction(async (query) => {
      const existing = await query<VersionRow>(`SELECT id,"recipeId","versionNumber",status FROM "RecipeVersion" WHERE checksum=$1 LIMIT 1`, [checksum]);
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.status === 'PUBLISHED') return { recipeVersionId: row.id, versionNumber: row.versionNumber, idempotent: true };
        // Defect 1 fix: promote THIS exact verified DRAFT through publication.
        return this.promoteDraftInTx(query, { input, versionId: row.id, versionNumber: row.versionNumber, recipeId: row.recipeId });
      }
      const recipe = await query<{ id: string }>(`INSERT INTO "Recipe" (name,servings,description,"portionGrams","recipeKey", "dataClass") VALUES ($1,$2,$3,$4,$5,'TEST_ONLY') ON CONFLICT ("recipeKey") DO UPDATE SET name=EXCLUDED.name RETURNING id`, [input.title, input.servings, input.description, input.yieldGrams / input.servings, input.recipeKey]);
      if (!recipe.rows[0]) throw new Error('RECIPE_CREATE_FAILED'); const recipeId = recipe.rows[0].id;
      await query(`SELECT id FROM "Recipe" WHERE id=$1 FOR UPDATE`, [recipeId]);
      const current = await query<{ n: number }>(`SELECT COALESCE(MAX("versionNumber"),0)+1 AS n FROM "RecipeVersion" WHERE "recipeId"=$1`, [recipeId]); const versionNumber = Number(current.rows[0]?.n ?? 1);
      const version = await query<{ id: string }>(`INSERT INTO "RecipeVersion" ("recipeId","versionNumber",status,"contentSnapshotJson","ingredientsSnapshotJson","stepsSnapshotJson","nutritionSnapshotJson","costSnapshotJson","restrictionSnapshotJson","servings","servingWeightGrams","changeType","createdBy","approvedBy","approvedAt","publishedAt",checksum,provenance) VALUES ($1,$2,'PUBLISHED',$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,'{}'::jsonb,$8,$9,'SYSTEM',$10,$10,now(),now(),$11,'SYSTEM') ON CONFLICT (checksum) DO NOTHING RETURNING id`, [recipeId, versionNumber, JSON.stringify({ title: input.title, description: input.description, servings: input.servings, automatedQualityPass: true, cookTestStatus: input.cookTest ? (input.cookTest.decision === 'PASS' ? 'PASSED' : 'FAILED') : 'NOT_PERFORMED', provenance: input.provenance ?? null }), JSON.stringify(input.ingredients), JSON.stringify(input.steps), JSON.stringify(input.nutrition), JSON.stringify(input.cost), input.servings, input.yieldGrams / input.servings, input.actorId, checksum]);
      if (!version.rows[0]) { const replay = await query<VersionRow>(`SELECT id,"recipeId","versionNumber",status FROM "RecipeVersion" WHERE checksum=$1 LIMIT 1`, [checksum]); if (!replay.rows[0]) throw new Error('VERSION_CREATE_FAILED'); if (replay.rows[0].status !== 'PUBLISHED') return this.promoteDraftInTx(query, { input, versionId: replay.rows[0].id, versionNumber: replay.rows[0].versionNumber, recipeId: replay.rows[0].recipeId }); return { recipeVersionId: replay.rows[0].id, versionNumber: replay.rows[0].versionNumber, idempotent: true }; }
      const versionId = version.rows[0].id;
      await this.supersedePreviousCurrentInTx(query, { recipeId, newVersionId: versionId, actorId: input.actorId });
      await this.ensurePublishedLifecycle(query, versionId, input.actorId);
      await query(`UPDATE "Recipe" SET "currentVersionId"=$1,"contentRevision"="contentRevision"+1 WHERE id=$2`, [versionId, recipeId]);
      return { recipeId, recipeVersionId: versionId, versionNumber, idempotent: false };
    });
  }

  /**
   * Atomic DRAFT -> PUBLISHED promotion of an already staged verified version.
   * All invariants flip in one transaction: row status, lifecycle,
   * publishedAt/approval stamps and Recipe.currentVersionId (+ shell metadata,
   * which may mirror the current version only at publication time).
   */
  private async promoteDraftInTx(query: SqlQuery, args: { input: PublicationInput; versionId: string; versionNumber: number; recipeId: string }) {
    await query(`SELECT id FROM "Recipe" WHERE id=$1 FOR UPDATE`, [args.recipeId]);
    await this.supersedePreviousCurrentInTx(query, { recipeId: args.recipeId, newVersionId: args.versionId, actorId: args.input.actorId });
    await this.ensureDraftLifecycle(query, args.versionId, args.input.actorId);
    const life = await query<{ lifecycleStatus: string; validationStatus: string; revision: number }>(`SELECT "lifecycleStatus","validationStatus",revision FROM "RecipeVersionLifecycle" WHERE "recipeVersionId"=$1 FOR UPDATE`, [args.versionId]);
    if (life.rows[0]?.lifecycleStatus === 'IN_REVIEW') {
      await query(`UPDATE "RecipeVersionLifecycle" SET "lifecycleStatus"='APPROVED',revision=revision+1,"changedAt"=now(),"changedBy"=$2,"reasonCode"='APPROVE' WHERE "recipeVersionId"=$1`, [args.versionId, args.input.actorId]);
      await query(`INSERT INTO "RecipeVersionLifecycleEvent" ("recipeVersionId","fromStatus","toStatus","validationFrom","validationTo","actorId","reasonCode") VALUES ($1,'IN_REVIEW','APPROVED','VALID','VALID',$2,'APPROVE')`, [args.versionId, args.input.actorId]);
    }
    await query(
      `UPDATE "RecipeVersionLifecycle"
       SET "lifecycleStatus"='PUBLISHED',"validationStatus"='VALID',revision=revision+1,"changedAt"=now(),"changedBy"=$2,"reasonCode"='PUBLISH'
       WHERE "recipeVersionId"=$1`,
      [args.versionId, args.input.actorId],
    );
    await query(
      `INSERT INTO "RecipeVersionLifecycleEvent" ("recipeVersionId","fromStatus","toStatus","validationFrom","validationTo","actorId","reasonCode")
       VALUES ($1,'APPROVED','PUBLISHED','VALID','VALID',$2,'PUBLISH')`,
      [args.versionId, args.input.actorId],
    );
    // Trigger-safe single statement: only rows still unpublished are touched,
    // and approval stamps are filled only when missing.
    const promoted = await query<{ id: string }>(
      `UPDATE "RecipeVersion"
       SET status='PUBLISHED',"publishedAt"=now(),"approvedBy"=COALESCE("approvedBy",$2),"approvedAt"=COALESCE("approvedAt",now())
       WHERE id=$1 AND "publishedAt" IS NULL AND status<>'PUBLISHED'
       RETURNING id`,
      [args.versionId, args.input.actorId],
    );
    if (!promoted.rows[0]) throw new Error('DRAFT_PROMOTION_FAILED');
    await query(
      `UPDATE "Recipe"
       SET "currentVersionId"=$1,"contentRevision"="contentRevision"+1,
           name=$2,servings=$3,description=$4,"portionGrams"=$5
       WHERE id=$6`,
      [args.versionId, args.input.title, args.input.servings, args.input.description, args.input.yieldGrams / args.input.servings, args.recipeId],
    );
    return { recipeId: args.recipeId, recipeVersionId: args.versionId, versionNumber: args.versionNumber, idempotent: false, promotedFromDraft: true as const };
  }

  /** Never leave a second PUBLISHED lifecycle for the same Recipe. */
  private async supersedePreviousCurrentInTx(query: SqlQuery, args: { recipeId: string; newVersionId: string; actorId: string }) {
    const prev = await query<{ currentVersionId: string | null }>(`SELECT "currentVersionId" FROM "Recipe" WHERE id=$1 FOR UPDATE`, [args.recipeId]);
    const previousId = prev.rows[0]?.currentVersionId ?? null;
    if (!previousId || previousId === args.newVersionId) return;
    const prevLife = await query<{ lifecycleStatus: string; validationStatus: string }>(`SELECT "lifecycleStatus","validationStatus" FROM "RecipeVersionLifecycle" WHERE "recipeVersionId"=$1 FOR UPDATE`, [previousId]);
    if (prevLife.rows[0]?.lifecycleStatus !== 'PUBLISHED') return;
    await query(
      `UPDATE "RecipeVersionLifecycle"
       SET "lifecycleStatus"='SUPERSEDED',revision=revision+1,"changedAt"=now(),"changedBy"=$2,"reasonCode"='SUPERSEDED_BY_PUBLISH'
       WHERE "recipeVersionId"=$1`,
      [previousId, args.actorId],
    );
    await query(
      `INSERT INTO "RecipeVersionLifecycleEvent" ("recipeVersionId","fromStatus","toStatus","validationFrom","validationTo","actorId","reasonCode")
       VALUES ($1,'PUBLISHED','SUPERSEDED',$2,$2,$3,'SUPERSEDED_BY_PUBLISH')`,
      [previousId, prevLife.rows[0].validationStatus, args.actorId],
    );
  }

  private async ensureDraftLifecycle(query: SqlQuery, versionId: string, actorId: string, withEvent = false) {
    await query(
      `INSERT INTO "RecipeVersionLifecycle" ("recipeVersionId","lifecycleStatus","validationStatus","revision","changedAt","changedBy","reasonCode")
       VALUES ($1,'IN_REVIEW','VALID',1,now(),$2,'SUBMIT')
       ON CONFLICT ("recipeVersionId") DO NOTHING`,
      [versionId, actorId],
    );
    if (withEvent) {
      await query(
        `INSERT INTO "RecipeVersionLifecycleEvent" ("recipeVersionId","fromStatus","toStatus","validationFrom","validationTo","actorId","reasonCode")
         VALUES ($1,NULL,'IN_REVIEW',NULL,'VALID',$2,'SUBMIT')`,
        [versionId, actorId],
      );
    }
  }

  private async ensurePublishedLifecycle(query: SqlQuery, versionId: string, actorId: string) {
    await query(
      `INSERT INTO "RecipeVersionLifecycle" ("recipeVersionId","lifecycleStatus","validationStatus","revision","changedAt","changedBy","reasonCode")
       VALUES ($1,'PUBLISHED','VALID',1,now(),$2,'PUBLISH')
       ON CONFLICT ("recipeVersionId") DO NOTHING`,
      [versionId, actorId],
    );
    await query(
      `INSERT INTO "RecipeVersionLifecycleEvent" ("recipeVersionId","fromStatus","toStatus","validationFrom","validationTo","actorId","reasonCode")
       VALUES ($1,'APPROVED','PUBLISHED','VALID','VALID',$2,'PUBLISH')`,
      [versionId, actorId],
    );
  }
}
