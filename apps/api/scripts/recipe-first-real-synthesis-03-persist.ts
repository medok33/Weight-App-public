import { existsSync, readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { RecipePublicationService } from '../src/modules/recipe-platform/application/recipe-publication.service.ts';
import { calculateRecipeNutrition } from '../src/modules/recipe-platform/domain/recipe-authoring.policy.ts';
import { firstRealSynthesisIngredients, firstRealSynthesisSkeleton, FIRST_REAL_SYNTHESIS_RECIPE_KEY } from '../src/modules/recipe-platform/domain/recipe-first-real-synthesis.policy.ts';
import { PrismaService } from '../src/infrastructure/database/prisma.service.ts';
import { runCatalogSeed } from '../src/modules/product-catalog/seed/apply-engine.ts';
import { buildCatalogCoreV2Manifest } from '../src/modules/product-catalog/seed/catalog-core-v2.dataset.ts';
import { buildCatalogCoreV3Manifest } from '../src/modules/product-catalog/seed/catalog-core-v3.dataset.ts';

const artifactPath = existsSync('.data/verification/recipe-first-real-synthesis-attempt-2.json')
  ? '.data/verification/recipe-first-real-synthesis-attempt-2.json'
  : 'apps/api/.data/verification/recipe-first-real-synthesis-attempt-2.json';
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { editor: { steps: Array<{ stepId: string; text: string }> } };
const ingredients = firstRealSynthesisIngredients();
const skeleton = firstRealSynthesisSkeleton();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaService();

async function main() {
  await runCatalogSeed({ client: pool, manifest: buildCatalogCoreV2Manifest(), mode: 'apply' });
  await runCatalogSeed({ client: pool, manifest: buildCatalogCoreV3Manifest(), mode: 'apply' });
  const nutritionRows = await pool.query<{ productKey: string; calories: string; protein: string; fat: string; carbohydrate: string }>(
    `SELECT p."productKey", n.calories::text, n.protein::text, n.fat::text, n.carbohydrate::text FROM "Product" p JOIN "ProductNutritionVersion" n ON n.id=p."currentNutritionVersionId" WHERE p."productKey"=ANY($1::text[])`,
    [ingredients.map((item) => item.productId)],
  );
  if (nutritionRows.rows.length !== ingredients.length) throw new Error('NUTRITION_AUTHORITY_INCOMPLETE');
  const nutrition = calculateRecipeNutrition(ingredients.map((item) => ({ productId: item.productId, amountGrams: item.amount })), nutritionRows.rows.map((row) => ({ productId: row.productKey, state: 'raw' as const, caloriesPer100g: Number(row.calories), proteinPer100g: Number(row.protein), fatPer100g: Number(row.fat), carbsPer100g: Number(row.carbohydrate) })), 4, 1427.3);
  const renderedById = new Map(artifact.editor.steps.map((step) => [step.stepId, step.text]));
  const steps = skeleton.map((step) => ({ index: step.order, text: renderedById.get(step.stepId) ?? '', ingredientIds: step.ingredientIds, ...(step.durationMinutes === undefined ? {} : { durationMinutes: step.durationMinutes }), ...(step.temperatureC === undefined ? {} : { temperatureC: step.temperatureC }) }));
  if (steps.some((step) => !step.text)) throw new Error('EDITOR_STEP_MAPPING_INCOMPLETE');
  const service = new RecipePublicationService(db);
  const input = { recipeKey: FIRST_REAL_SYNTHESIS_RECIPE_KEY, title: 'Жульен с курицей и грибами', description: 'Синтезированный рецепт классического жульена.', servings: 4, yieldGrams: 1427.3, ingredients, steps, nutrition, cost: { status: 'UNAVAILABLE', currency: 'RUB' }, validationPass: true, similarityAutoPublish: true, automatedQualityPass: true, actorId: '00000000-0000-0000-0000-000000000001', provenance: { synthesisBriefId: 'recipe-first-real-synthesis/v1', clusterId: 'dcluster_8c521f996b1e8844f530ff12', nutritionAuthority: 'ProductNutritionVersion', editorArtifact: 'recipe-first-real-synthesis-attempt-2' } };
  const first = await service.publish(input);
  const second = await service.publish(input);
  const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "RecipeVersion" WHERE "recipeId"=$1', [first.recipeId]);
  console.log(JSON.stringify({ REAL_RECIPE_VERSIONS_CREATED: first.idempotent ? 0 : 1, RECIPE_VERSION_ID: first.recipeVersionId, SECOND_NEW_RECIPE_VERSIONS: second.idempotent ? 0 : 1, IDEMPOTENCY: second.idempotent === true && count.rows[0]?.count === '1' ? 'PASS' : 'FAIL' }, null, 2));
  // RecipeVersion is immutable by design; disposable DB teardown owns cleanup.
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => { await db.onModuleDestroy(); await pool.end(); });
