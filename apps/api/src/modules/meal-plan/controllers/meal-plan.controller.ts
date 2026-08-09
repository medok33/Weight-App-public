import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { MealPlanService } from '../application/meal-plan.service';
import { MealDishDetailService } from '../application/meal-dish-detail.service';
import { MealSubstitutionService } from '../application/meal-substitution.service';
import { toMealPlanSummary } from '../domain/meal-plan.mapper';
import type { CompensationOption, SubstitutionKind } from '../domain/substitution.types';

@Controller('meal-plan')
export class MealPlanController {
  constructor(
    @Inject(MealPlanService) private readonly service: MealPlanService,
    @Inject(MealDishDetailService) private readonly dishDetail: MealDishDetailService,
    @Inject(MealSubstitutionService) private readonly substitutions: MealSubstitutionService,
  ) {}

  @Get()
  async get(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.getSummary(user.id);
    } catch {
      throw new NotFoundException('MEAL_PLAN_NOT_FOUND');
    }
  }

  @Get('days/:dayIndex')
  async getDay(
    @CurrentUser() user: RequestUser,
    @Param('dayIndex') dayIndexRaw: string,
    @Query('planId') planId?: string,
  ) {
    const dayIndex = Number(dayIndexRaw);
    if (!Number.isInteger(dayIndex) || dayIndex < 0) throw new NotFoundException('MEAL_PLAN_DAY_NOT_FOUND');
    try {
      await this.service.getActivePlan(user.id);
      const targets = await this.service.resolveTargets(user.id);
      return await this.dishDetail.getDayDetail(user.id, dayIndex, targets, planId);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'MEAL_PLAN_FORBIDDEN') throw new ForbiddenException('MEAL_PLAN_FORBIDDEN');
      throw new NotFoundException('MEAL_PLAN_DAY_NOT_FOUND');
    }
  }

  @Get('items/:itemId/details')
  async getItemDetails(@CurrentUser() user: RequestUser, @Param('itemId') itemId: string) {
    try {
      await this.service.getActivePlan(user.id);
      const targets = await this.service.resolveTargets(user.id);
      return await this.dishDetail.getItemDetails(user.id, itemId, targets);
    } catch (error) {
      throw mapItemError(error);
    }
  }

  @Get('items/:itemId/substitutions')
  async listSubstitutions(
    @CurrentUser() user: RequestUser,
    @Param('itemId') itemId: string,
    @Query('type') typeRaw?: string,
    @Query('ingredientProductId') ingredientProductId?: string,
  ) {
    const kind: SubstitutionKind =
      typeRaw === 'ingredient' || typeRaw === 'REPLACE_INGREDIENT' ? 'REPLACE_INGREDIENT' : 'REPLACE_DISH';
    try {
      await this.service.getActivePlan(user.id);
      return await this.substitutions.listCandidates(user.id, itemId, kind, ingredientProductId);
    } catch (error) {
      throw mapItemError(error);
    }
  }

  @Post('items/:itemId/substitutions/preview')
  async previewSubstitution(
    @CurrentUser() user: RequestUser,
    @Param('itemId') itemId: string,
    @Body() body: { candidateId?: string; compensation?: CompensationOption | null },
  ) {
    if (!body?.candidateId || typeof body.candidateId !== 'string') {
      throw new BadRequestException('SUBSTITUTION_CANDIDATE_REQUIRED');
    }
    try {
      await this.service.getActivePlan(user.id);
      return await this.substitutions.preview(user.id, itemId, {
        candidateId: body.candidateId,
        compensation: body.compensation ?? null,
      });
    } catch (error) {
      throw mapItemError(error);
    }
  }

  @Post('items/:itemId/substitutions/cancel')
  async cancelSubstitution(
    @CurrentUser() user: RequestUser,
    @Param('itemId') itemId: string,
    @Body() body: { planId?: string },
  ) {
    if (!body?.planId) throw new BadRequestException('SUBSTITUTION_PLAN_REQUIRED');
    try {
      await this.substitutions.cancel(user.id, itemId, body.planId);
      return { cancelled: true };
    } catch (error) {
      throw mapItemError(error);
    }
  }

  @Post('generate')
  async generate(
    @CurrentUser() user: RequestUser,
    @Body() body: { recipes?: unknown[]; idempotencyKey?: string },
  ) {
    const recipes = Array.isArray(body.recipes) ? body.recipes : [];
    const plan = await this.service.generateOnce(user.id, recipes as never, body.idempotencyKey);
    const targets = await this.service.resolveTargets(user.id);
    return toMealPlanSummary(plan, targets);
  }

  @Post('regenerate')
  async regenerate(@CurrentUser() user: RequestUser) {
    try {
      const plan = await this.service.regenerateForUser(user.id);
      const targets = await this.service.resolveTargets(user.id);
      return toMealPlanSummary(plan, targets);
    } catch {
      throw new NotFoundException('MEAL_PLAN_NOT_FOUND');
    }
  }
}

function mapItemError(error: unknown): Error {
  const code = error instanceof Error ? error.message : '';
  if (code === 'MEAL_PLAN_ITEM_FORBIDDEN' || code === 'MEAL_PLAN_FORBIDDEN') {
    return new ForbiddenException(code);
  }
  if (code === 'SUBSTITUTION_CANDIDATE_STALE' || code === 'SUBSTITUTION_CANDIDATE_INVALID') {
    return new ConflictException(code);
  }
  if (code === 'SUBSTITUTION_INGREDIENT_REQUIRED') return new BadRequestException(code);
  if (
    code === 'MEAL_PLAN_ITEM_NOT_FOUND' ||
    code === 'MEAL_PLAN_RECIPE_NOT_FOUND' ||
    code === 'MEAL_PLAN_DAY_NOT_FOUND'
  ) {
    return new NotFoundException(code);
  }
  return new BadRequestException(code || 'SUBSTITUTION_FAILED');
}
