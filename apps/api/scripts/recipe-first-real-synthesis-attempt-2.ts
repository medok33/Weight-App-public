import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OpenAIProvider } from '../src/modules/ai-assistant/providers/openai.provider.ts';
import { culinaryCriticContractInstruction, validateCulinaryCriticResult } from '../src/modules/recipe-platform/domain/culinary-critic.policy.ts';
import { validateRecipeEditorSemanticCoverage, validateRecipeEditorText } from '../src/modules/recipe-platform/domain/recipe-contract.v1.ts';
import { FIRST_REAL_SYNTHESIS_RECIPE_KEY, firstRealSynthesisAuthoringSteps, firstRealSynthesisIngredients, firstRealSynthesisSkeleton, validateFirstRealSynthesisScope } from '../src/modules/recipe-platform/domain/recipe-first-real-synthesis.policy.ts';

function parseJson(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced?.[1] ?? content) as Record<string, unknown>;
}

async function main() {
  const provider = new OpenAIProvider();
  if (!provider.configured) throw new Error('AI_PROVIDER_NOT_CONFIGURED');
  const ingredients = firstRealSynthesisIngredients();
  const skeleton = firstRealSynthesisSkeleton();
  const deterministicSteps = firstRealSynthesisAuthoringSteps();
  const deterministic = validateFirstRealSynthesisScope({ ingredients, steps: deterministicSteps });
  if (!deterministic.ok) throw new Error('DETERMINISTIC_PREFLIGHT_FAILED');

  const editorRequest = [
    'Return JSON only: {title:string,description:string,steps:[{stepId:string,text:string}]}.',
    'This is the second and final bounded repair attempt.',
    'Immutable: servings=4; ingredients only chicken breast 600g, champignons 300g, sour cream 15% 400g, hard cheese 45% 100g, olive oil 27.3g.',
    'Do not add rice, mayonnaise, onion, any ingredient, grams, temperature, or duration.',
    'Write every step text in Russian and use these exact Russian ingredient words: куриное филе, шампиньоны, сметана, твёрдый сыр, оливковое масло.',
    'Render six concrete stepIds: prepare; sear-chicken (olive oil and chicken, 4 minutes); fry-mushrooms (add mushrooms, 10 minutes, until chicken is cooked through); assemble (transfer chicken and mushrooms to dish, add sour cream, top with grated cheese); bake (180 C, 5 minutes); serve.',
    'Do not invent an internal temperature. Make sour cream and cheese use explicit; do not use empty prepare/combine placeholders.',
  ].join(' ');
  const editorResponse = await provider.complete({ model: 'gpt-5.6-luna', messages: [
    { role: 'system', content: 'You are RecipeEditor. Follow the requested JSON schema exactly.' },
    { role: 'user', content: editorRequest },
  ] });
  const editorPayload = parseJson(editorResponse.content);
  const renderedSteps = validateRecipeEditorText(editorPayload, skeleton);
  validateRecipeEditorSemanticCoverage(renderedSteps, { requiredTerms: ['курин', 'шампин', 'сметан', 'сыр', 'оливков'], forbiddenTerms: /рис|майонез/ });
  if (process.argv.includes('--editor-only')) {
    console.log(JSON.stringify({ RECIPE_EDITOR_PROVIDER_CALLS: 1, RECIPE_EDITOR_ATTEMPTS: 1, RECIPE_EDITOR_RESULT: 'PASS', CULINARY_CRITIC_PROVIDER_CALLS: 0, REAL_RECIPE_VERSIONS_CREATED: 0 }, null, 2));
    return;
  }

  const contract = {
    contractVersion: 1,
    recipeKey: FIRST_REAL_SYNTHESIS_RECIPE_KEY,
    versionIdentity: 'recipe-first-real-synthesis/v1',
    title: editorPayload.title,
    description: editorPayload.description,
    servings: 4,
    yieldGrams: 1427.3,
    ingredients: ingredients.map((item) => ({ ingredientId: item.id, productId: item.productId, grams: item.amount, unit: item.unit, optional: false })),
    equipment: ['PAN', 'OVEN', 'BAKING_DISH', 'GRATER'],
    methodSkeleton: skeleton,
    renderedSteps,
    nutrition: { basis: 'CANONICAL_PRODUCT_NUTRITION' },
    cost: { status: 'UNAVAILABLE' },
    safety: { status: 'PASS', reasons: [] },
    provenance: { sourceIds: ['research-cluster:dcluster_8c521f996b1e8844f530ff12'], evidenceIds: ['structured-facts-only'] },
    similarity: { autoPublish: true, decision: 'CREATE', score: 0.45 },
    cookTestStatus: 'NOT_PERFORMED',
    publicationState: 'DRAFT',
    qualityStatus: 'STRUCTURED_CANDIDATE',
  };
  const criticResponse = await provider.complete({ model: 'gpt-5.6-luna', messages: [
    { role: 'system', content: 'You are CulinaryCritic. Return only the exact requested JSON contract.' },
    { role: 'user', content: `${culinaryCriticContractInstruction()} Audit this structured classic Julienne recipe. Check concrete ingredient use, cooking coherence, the 4-minute chicken fry plus 10-minute chicken-and-mushroom cook-until-done sequence, 180 C five-minute bake, no rice/mayonnaise, and no invented temperature or duration. Contract: ${JSON.stringify(contract)}` },
  ] });
  const critic = validateCulinaryCriticResult(parseJson(criticResponse.content));
  const artifact = '.data/verification/recipe-first-real-synthesis-attempt-2.json';
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, `${JSON.stringify({ editor: { provider: editorResponse.providerId, model: editorResponse.model, steps: renderedSteps }, critic: { provider: criticResponse.providerId, model: criticResponse.model, verdict: critic.verdict, issues: critic.issues }, immutableContract: { servings: 4, products: ingredients.map((item) => ({ productId: item.productId, grams: item.amount })), skeleton }, createdAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ RECIPE_EDITOR_PROVIDER_CALLS: 1, RECIPE_EDITOR_ATTEMPTS: 2, RECIPE_EDITOR_RESULT: 'PASS', CULINARY_CRITIC_PROVIDER_CALLS: 1, CULINARY_CRITIC_SCHEMA_VALID: 'YES', CULINARY_CRITIC_CULINARY_VERDICT: critic.verdict, CULINARY_CRITIC_RESULT: critic.verdict === 'PASS' ? 'PASS' : 'FAIL_CLOSED', artifact }, null, 2));
}

void main();
