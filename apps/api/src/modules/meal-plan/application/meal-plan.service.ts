import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  adaptPlanForLifeMode,
  buildWeeklyPlan,
  nextImmutableVersion,
  selectRecipeCandidates,
  substituteRecipe,
  transitionPlan,
  validatePlan,
} from '../domain/meal-plan.policy';
import { DEFAULT_MEAL_RECIPES } from '../domain/meal-plan.defaults';
import { toMealPlanSummary } from '../domain/meal-plan.mapper';
import { resolveNutritionTargets, type NutritionTargets } from '../domain/meal-plan.nutrition';
import type { LifeMode, MealPlan, PlanLifecycle, RecipeCandidate, OutboxEvent } from '../domain/meal-plan.types';
import { InMemoryMealPlanRepository } from '../infrastructure/meal-plan.repository.memory';
import { MealPlanRepository } from '../infrastructure/meal-plan.repository';
import { MealDishCatalogRepository } from '../infrastructure/meal-dish-catalog.repository';
import { UserProfileService } from '../../user-profile/application/user-profile.service';
import { PantryService } from '../../pantry/application/pantry.service';
import { RecipeVersionService } from '../../recipe-platform/application/recipe-version.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23505') return true;
  const message = String((err as { message?: string } | null)?.message ?? err ?? '');
  return /duplicate key value violates unique constraint/i.test(message);
}

@Injectable()
export class MealPlanService {
  private readonly events: OutboxEvent[] = [];
  private readonly repository: MealPlanRepository | InMemoryMealPlanRepository;

  constructor(
    @Optional() @Inject(MealPlanRepository) repository?: MealPlanRepository,
    @Optional() @Inject(UserProfileService) private readonly userProfile?: UserProfileService,
    @Optional() @Inject(PantryService) private readonly pantry?: PantryService,
    @Optional() @Inject(MealDishCatalogRepository) private readonly catalog?: MealDishCatalogRepository,
    @Optional() @Inject(RecipeVersionService) private readonly recipeVersions?: RecipeVersionService,
    @Optional() @Inject(PrismaService) private readonly db?: PrismaService,
  ) {
    this.repository = repository ?? new InMemoryMealPlanRepository();
  }

  async createWeekly(userId: string, recipes: RecipeCandidate[], options?: { targetKcal?: number; version?: number }) {
    await this.catalog?.ensureCatalog();
    const plan = validatePlan(buildWeeklyPlan(userId, recipes, options));
    const pinned = await this.pinRecipeVersions(plan);
    return this.repository.save(pinned);
  }

  /** Resolve usable RecipeVersion for each meal; drop meals without usable version. */
  private async pinRecipeVersions(plan: MealPlan): Promise<MealPlan> {
    if (!this.recipeVersions && !this.db) return plan;
    const days = [];
    for (const day of plan.days) {
      const meals = [];
      for (const meal of day.meals) {
        if (!meal.recipeId) continue;
        let versionId: string | null = null;
        if (this.recipeVersions) {
          versionId = await this.recipeVersions.resolveUsableVersionId(meal.recipeId);
        } else if (this.db) {
          const row = await this.db.query<{ id: string }>(
            `SELECT COALESCE(r."currentVersionId", (
               SELECT v.id FROM "RecipeVersion" v
               WHERE v."recipeId" = r.id AND v."publishedAt" IS NOT NULL
               ORDER BY v."versionNumber" DESC LIMIT 1
             )) AS id
             FROM "Recipe" r WHERE r.id = $1`,
            [meal.recipeId],
          );
          versionId = row.rows[0]?.id ?? null;
        }
        if (!versionId) {
          // Controlled skip — never create MealItem on mutable Recipe alone.
          continue;
        }
        meals.push({
          ...meal,
          recipeVersionId: versionId,
          contentProvenance: 'RECIPE_VERSION',
        });
      }
      days.push({ ...day, meals });
    }
    return { ...plan, days };
  }

  async resolveTargets(userId: string): Promise<NutritionTargets | null> {
    if (!this.userProfile) return null;
    const [profile, goal] = await Promise.all([this.userProfile.getProfile(userId), this.userProfile.getGoal(userId)]);
    return resolveNutritionTargets(profile, goal);
  }

  async getActivePlan(userId: string) {
    if (!userId) throw new Error('MEAL_PLAN_USER_REQUIRED');
    await this.catalog?.ensureCatalog();
    for (let attempt = 0; attempt < 4; attempt++) {
      const existing = await this.repository.findLatestByUserId(userId);
      if (existing && isStructuredMealPlan(existing)) return existing;
      try {
        if (existing) return await this.regenerateForUser(userId);
        const targets = await this.resolveTargets(userId);
        return await this.createWeekly(userId, DEFAULT_MEAL_RECIPES, { targetKcal: targets?.targetKcal });
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 3) throw err;
      }
    }
    throw new Error('MEAL_PLAN_GET_ACTIVE_FAILED');
  }

  async getSummary(userId: string) {
    const [plan, targets] = await Promise.all([this.getActivePlan(userId), this.resolveTargets(userId)]);
    return toMealPlanSummary(plan, targets);
  }

  async regenerateForUser(userId: string) {
    if (!userId) throw new Error('MEAL_PLAN_USER_REQUIRED');
    await this.catalog?.ensureCatalog();
    const targets = await this.resolveTargets(userId);
    const recipes = this.pantry
      ? await this.pantry.weightCandidates(userId, DEFAULT_MEAL_RECIPES)
      : DEFAULT_MEAL_RECIPES;
    for (let attempt = 0; attempt < 4; attempt++) {
      const existing = await this.repository.all(userId);
      const version = existing.length ? nextImmutableVersion(existing) : 1;
      try {
        return await this.createWeekly(userId, recipes, { targetKcal: targets?.targetKcal, version });
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 3) throw err;
      }
    }
    throw new Error('MEAL_PLAN_REGENERATE_FAILED');
  }

  async generateOnce(userId: string, recipes: RecipeCandidate[], idempotencyKey: string) {
    if (!userId || !idempotencyKey) throw new Error('MEAL_PLAN_GENERATION_INVALID');
    const existingEvent = this.events.find((event) => event.idempotencyKey === idempotencyKey);
    if (existingEvent) {
      const version = Number(existingEvent.aggregateId.split(':').pop());
      const plans = await this.repository.all(userId);
      return plans.find((plan) => plan.version === version) ?? this.regenerateForUser(userId);
    }
    const targets = await this.resolveTargets(userId);
    const recipeList = recipes?.length ? recipes : DEFAULT_MEAL_RECIPES;
    const existing = await this.repository.all(userId);
    const version = existing.length ? nextImmutableVersion(existing) : 1;
    const plan = await this.createWeekly(userId, recipeList, {
      targetKcal: recipes?.length ? undefined : targets?.targetKcal,
      version,
    });
    this.events.push(
      Object.freeze({
        id: `evt_${idempotencyKey}`,
        type: 'meal_plan.generate',
        aggregateId: `${userId}:${plan.version}`,
        idempotencyKey,
      }),
    );
    return plan;
  }

  async versioned(userId: string, plan: MealPlan) {
    const existing = await this.repository.all(userId);
    return this.repository.save(
      validatePlan({
        ...plan,
        userId,
        version: nextImmutableVersion(existing),
      }),
    );
  }

  select(recipes: RecipeCandidate[], excluded: string[]) {
    return selectRecipeCandidates(recipes, excluded);
  }

  substitute(recipes: RecipeCandidate[], excluded: string[], currentId?: string) {
    return substituteRecipe(recipes, excluded, currentId);
  }

  adapt(plan: MealPlan, mode: LifeMode) {
    return adaptPlanForLifeMode(plan, mode);
  }

  transition(state: PlanLifecycle, next: PlanLifecycle) {
    return transitionPlan(state, next);
  }
}

function isStructuredMealPlan(plan: MealPlan): boolean {
  const day = plan.days[0];
  if (!day || day.meals.length < 4) return false;
  return day.meals.every((meal) => Boolean(meal.recipeId && /^[0-9a-f-]{36}$/i.test(meal.recipeId)));
}
