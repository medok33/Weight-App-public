import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MealPlanModule } from '../meal-plan/meal-plan.module';
import { ShoppingListModule } from '../shopping-list/shopping-list.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { ExportShareService } from './application/export-share.service';
import { ExportShareController } from './controllers/export-share.controller';
import { ExportShareRepository } from './infrastructure/export-share.repository';
import { LocalObjectStorage } from './infrastructure/local-object-storage';

@Module({
  imports: [DatabaseModule, MealPlanModule, ShoppingListModule, UserProfileModule],
  controllers: [ExportShareController],
  providers: [ExportShareService, ExportShareRepository, LocalObjectStorage],
  exports: [ExportShareService],
})
export class ExportShareModule {}
