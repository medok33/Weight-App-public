import { Body, Controller, Delete, Get, Inject, NotFoundException, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { MealTrackingService } from '../application/meal-tracking.service';

@Controller('meal-tracking')
export class MealTrackingController {
  constructor(@Inject(MealTrackingService) private readonly service: MealTrackingService) {}

  @Get('today')
  async today(@CurrentUser() user: RequestUser, @Query('date') date?: string) {
    try {
      return await this.service.getToday(user.id, date);
    } catch {
      throw new NotFoundException('MEAL_TRACKING_NOT_FOUND');
    }
  }

  @Post('complete')
  async complete(@CurrentUser() user: RequestUser, @Body() body: { mealId?: string; date?: string }) {
    if (!body.mealId) throw new NotFoundException('MEAL_TRACKING_INVALID');
    try {
      return await this.service.completeMeal(user.id, body.mealId, body.date);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MEAL_TRACKING_FAILED';
      throw new NotFoundException(message);
    }
  }

  @Delete('complete')
  async uncomplete(
    @CurrentUser() user: RequestUser,
    @Query('mealId') mealId?: string,
    @Query('date') date?: string,
  ) {
    if (!mealId) throw new NotFoundException('MEAL_TRACKING_INVALID');
    try {
      return await this.service.uncompleteMeal(user.id, mealId, date);
    } catch {
      throw new NotFoundException('MEAL_TRACKING_FAILED');
    }
  }
}
