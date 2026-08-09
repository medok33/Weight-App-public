import { Body, Controller, Get, Inject, NotFoundException, Put } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { UserProfileService } from '../application/user-profile.service';
import type { ProfileUpsertInput } from '../domain/user-profile.types';

@Controller('profile')
export class UserProfileController {
  constructor(@Inject(UserProfileService) private readonly service: UserProfileService) {}

  @Get()
  async get(@CurrentUser() user: RequestUser) {
    try {
      const profile = await this.service.getProfile(user.id);
      if (!profile) throw new NotFoundException('PROFILE_NOT_FOUND');
      return profile;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }
  }

  @Put()
  async put(@CurrentUser() user: RequestUser, @Body() body: ProfileUpsertInput) {
    try {
      return await this.service.upsertProfile(user.id, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PROFILE_SAVE_FAILED';
      throw new NotFoundException(message);
    }
  }
}
