import { BadRequestException, Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import type { RecipeCandidate } from '../../meal-plan/domain/meal-plan.types';
import { BudgetModeService } from '../application/budget-mode.service';

@Controller('budget-mode')
export class BudgetModeController {
  constructor(@Inject(BudgetModeService) private readonly service: BudgetModeService) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.service.get(user.id);
  }

  @Post()
  set(@CurrentUser() user: RequestUser, @Body() body: { mode?: string }) {
    try { return this.service.set(user.id, body); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'BUDGET_MODE_INVALID'); }
  }

  @Post('optimize')
  optimize(@CurrentUser() user: RequestUser, @Body() body: { candidates?: RecipeCandidate[]; excludedTags?: string[] }) {
    return this.service.optimize(user.id, { candidates: body.candidates ?? [], excludedTags: body.excludedTags });
  }
}
