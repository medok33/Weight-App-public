import { describe, expect, it } from 'vitest';
import { runCatalogSeed } from '../../src/modules/product-catalog/seed/apply-engine';
import { buildCatalogCoreV2Manifest } from '../../src/modules/product-catalog/seed/catalog-core-v2.dataset';
import { buildCatalogCoreV3Manifest } from '../../src/modules/product-catalog/seed/catalog-core-v3.dataset';
import { RecipePublicationService } from '../../src/modules/recipe-platform/application/recipe-publication.service';
import { RecipeQualityOrchestrator } from '../../src/modules/recipe-platform/application/recipe-quality.orchestrator';
import { issueVerifiedQualityReceipt } from '../../src/modules/recipe-platform/domain/recipe-quality.receipt';
import { validateChefEditorOutput } from '../../src/modules/recipe-platform/domain/recipe-authoring.policy';
import { FIRST_REAL_SYNTHESIS_PRODUCTS, FIRST_REAL_SYNTHESIS_RECIPE_KEY, FIRST_REAL_SYNTHESIS_SERVINGS, firstRealSynthesisAuthoringSteps, firstRealSynthesisIngredients, firstRealSynthesisNutrition, firstRealSynthesisSkeleton, validateFirstRealSynthesisScope } from '../../src/modules/recipe-platform/domain/recipe-first-real-synthesis.policy';
import { runSynthesisReadiness } from '../../scripts/recipe-corpus-synthesis-readiness-01';
import { runProductSelectionWithPersistence } from '../../scripts/recipe-product-selection-01';
import { withDisposableMigratedDb } from './helpers/disposable-catalog-db';

describe('RECIPE-FIRST-REAL-SYNTHESIS-01 disposable acceptance', () => {
  it('freezes the scoped Julienne data, passes automated gates and creates exactly one backend RecipeVersion', async () => {
    await withDisposableMigratedDb(async ({ pool, connectionString, createDb }) => {
      await runCatalogSeed({ client: pool, manifest: buildCatalogCoreV2Manifest(), mode: 'apply' });
      await runCatalogSeed({ client: pool, manifest: buildCatalogCoreV3Manifest(), mode: 'apply' });
      await runSynthesisReadiness(connectionString);
      await runProductSelectionWithPersistence(connectionString, { applySynthesisDefaults: true });

      const cluster = await pool.query<{ id: string }>(`SELECT id FROM "DishConceptCluster" WHERE "conceptKey"=$1`, ['cluster:19']);
      expect(cluster.rows.length).toBeLessThanOrEqual(1);
      const nutritionRows = await pool.query<{ productKey: string; calories: string; protein: string; fat: string; carbohydrate: string }>(
        `SELECT p."productKey", n.calories::text, n.protein::text, n.fat::text, n.carbohydrate::text
           FROM "Product" p JOIN "ProductNutritionVersion" n ON n.id=p."currentNutritionVersionId"
          WHERE p."productKey"=ANY($1::text[]) ORDER BY p."productKey"`,
        [FIRST_REAL_SYNTHESIS_PRODUCTS],
      );
      expect(nutritionRows.rows).toHaveLength(FIRST_REAL_SYNTHESIS_PRODUCTS.length);
      const nutrition = nutritionRows.rows.map((row) => ({ productId: row.productKey, state: 'raw' as const, caloriesPer100g: Number(row.calories), proteinPer100g: Number(row.protein), fatPer100g: Number(row.fat), carbsPer100g: Number(row.carbohydrate) }));
      const ingredients = firstRealSynthesisIngredients();
      const skeleton = firstRealSynthesisSkeleton();
      const authoringSteps = firstRealSynthesisAuthoringSteps();
      const deterministic = validateFirstRealSynthesisScope({ ingredients, steps: authoringSteps });
      const nutritionResult = firstRealSynthesisNutrition(nutrition);
      expect(deterministic.ok).toBe(true);
      expect(nutritionResult.gate.ok).toBe(true);

      const chef = validateChefEditorOutput({ contractVersion: 'chef-editor/v1', title: 'Жульен с курицей и грибами', description: 'Горячее блюдо для четырёх порций.', steps: authoringSteps.map((step) => ({ ...step, text: `Шаг ${step.index}: выполните ${step.text}.` })), method: 'Готовьте последовательно по утверждённому каркасу.', presentation: 'Подавайте горячим.', notes: [] }, ingredients.map((item) => item.id));
      const quality = await new RecipeQualityOrchestrator().verify({
        deterministicValid: deterministic.ok && nutritionResult.gate.ok,
        base: {
          contractVersion: 1, recipeKey: FIRST_REAL_SYNTHESIS_RECIPE_KEY, versionIdentity: 'recipe-first-real-synthesis/v1', title: chef.title, description: chef.description, servings: FIRST_REAL_SYNTHESIS_SERVINGS,
          yieldGrams: ingredients.reduce((sum, item) => sum + item.amount, 0), ingredients: ingredients.map((item) => ({ ingredientId: item.id, productId: item.productId, grams: item.amount, unit: item.unit, optional: item.optional === true })), equipment: ['PAN', 'OVEN', 'BAKING_DISH', 'GRATER'], methodSkeleton: skeleton,
          nutrition: nutritionResult.nutrition, cost: { status: 'UNAVAILABLE', currency: 'RUB' }, safety: deterministic.safety, provenance: { sourceIds: ['research-cluster:dcluster_8c521f996b1e8844f530ff12'], evidenceIds: ['structured-facts-only'] }, similarity: { autoPublish: deterministic.similarity.autoPublish, decision: deterministic.similarity.decision, score: deterministic.similarity.score }, cookTestStatus: 'NOT_PERFORMED', publicationState: 'PUBLISHED',
        },
        editor: async () => ({ title: chef.title, description: chef.description, steps: skeleton.map((step) => ({ stepId: step.stepId, text: chef.steps[step.order - 1]!.text })) }),
        critic: async () => ({ contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] }),
        semanticCoverage: { requiredTerms: ['выполните', 'куриное', 'шампиньоны', 'сметан', 'сыр', 'масло'], forbiddenTerms: /рис|майонез/ },
      });
      expect(quality.status).toBe('AUTO_VERIFIED');
      const service = new RecipePublicationService(createDb());
      const input = { recipeKey: FIRST_REAL_SYNTHESIS_RECIPE_KEY, title: chef.title, description: chef.description, servings: FIRST_REAL_SYNTHESIS_SERVINGS, yieldGrams: ingredients.reduce((sum, item) => sum + item.amount, 0), ingredients, steps: authoringSteps, nutrition: nutritionResult.nutrition, cost: { status: 'UNAVAILABLE', currency: 'RUB' }, similarityAutoPublish: true, actorId: '00000000-0000-0000-0000-000000000001', provenance: { synthesisBriefId: 'structured-test-brief', clusterId: 'dcluster_8c521f996b1e8844f530ff12', nutritionAuthority: 'ProductNutritionVersion' }, qualityContract: quality.contract!, qualityReceipt: quality.receipt! };
      const first = await service.publish(input);
      const second = await service.publish(input);
      expect(first.idempotent).toBe(false);
      expect(second).toMatchObject({ recipeVersionId: first.recipeVersionId, idempotent: true });
      const versions = await pool.query<{ count: string; status: string; provenance: string }>(`SELECT count(*)::text AS count, max(status) AS status, max(provenance) AS provenance FROM "RecipeVersion"`);
      const content = await pool.query<{ content: { provenance?: { clusterId?: string } } }>(`SELECT "contentSnapshotJson" AS content FROM "RecipeVersion" LIMIT 1`);
      expect(versions.rows[0]).toMatchObject({ count: '1', status: 'PUBLISHED', provenance: 'SYSTEM' });
      expect(content.rows[0]?.content.provenance?.clusterId).toBe('dcluster_8c521f996b1e8844f530ff12');

      const raceKey = `${FIRST_REAL_SYNTHESIS_RECIPE_KEY}:race`;
      const raceContract = { ...quality.contract!, recipeKey: raceKey };
      const raceInput = { ...input, recipeKey: raceKey, qualityContract: raceContract, qualityReceipt: issueVerifiedQualityReceipt({ contract: raceContract, critic: { contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] } }) };
      const [raceA, raceB] = await Promise.all([service.publish(raceInput), service.publish(raceInput)]);
      expect(raceA.recipeVersionId).toBe(raceB.recipeVersionId);
      expect([raceA.idempotent, raceB.idempotent].sort()).toEqual([false, true]);
      const raceCount = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "RecipeVersion" v JOIN "Recipe" r ON r.id=v."recipeId" WHERE r."recipeKey"=$1`, [raceKey]);
      expect(raceCount.rows[0]?.count).toBe('1');

      const distinctKey = `${FIRST_REAL_SYNTHESIS_RECIPE_KEY}:distinct`;
      const distinctContract = { ...quality.contract!, recipeKey: distinctKey, title: 'Жульен — новая публикация' };
      const distinctInput = { ...input, recipeKey: distinctKey, title: distinctContract.title, qualityContract: distinctContract, qualityReceipt: issueVerifiedQualityReceipt({ contract: distinctContract, critic: { contractVersion: 'culinary-critic/v1', verdict: 'PASS', issues: [] } }) };
      const distinct = await service.publish(distinctInput);
      expect(distinct.idempotent).toBe(false);
    });
  }, 300_000);
});
