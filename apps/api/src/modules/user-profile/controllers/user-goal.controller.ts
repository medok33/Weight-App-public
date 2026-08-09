import { Body, Controller, Get, Inject, NotFoundException, Put } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { UserProfileService } from '../application/user-profile.service';
import type { GoalUpsertInput } from '../domain/user-profile.types';

@Controller('goal')
export class UserGoalController {
  constructor(@Inject(UserProfileService) private readonly service: UserProfileService) {}

  @Get()
  async get(@CurrentUser() user: RequestUser) {
    try {
      const goal = await this.service.getGoal(user.id);
      if (!goal) throw new NotFoundException('GOAL_NOT_FOUND');
      return goal;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException('GOAL_NOT_FOUND');
    }
  }

  @Put()
  async put(@CurrentUser() user: RequestUser, @Body() body: GoalUpsertInput) {
    try {
      return await this.service.upsertGoal(user.id, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GOAL_SAVE_FAILED';
      throw new NotFoundException(message);
    }
  }
}
