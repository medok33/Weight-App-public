import { Controller, Inject, Post } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { UserProfileService } from '../application/user-profile.service';

@Controller('user-context')
export class UserContextController {
  constructor(@Inject(UserProfileService) private readonly service: UserProfileService) {}

  @Public()
  @Post('bootstrap')
  async bootstrap() {
    const userId = await this.service.bootstrapUser();
    return { userId };
  }
}
