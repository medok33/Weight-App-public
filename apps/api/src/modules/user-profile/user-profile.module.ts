import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { UserProfileService } from './application/user-profile.service';
import { UserContextController } from './controllers/user-context.controller';
import { UserGoalController } from './controllers/user-goal.controller';
import { UserProfileController } from './controllers/user-profile.controller';
import { UserProfileRepository } from './infrastructure/user-profile.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [UserContextController, UserProfileController, UserGoalController],
  providers: [UserProfileService, UserProfileRepository],
  exports: [UserProfileService],
})
export class UserProfileModule {}
