import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MealPlanModule } from '../meal-plan/meal-plan.module';
import { MealTrackingController } from './controllers/meal-tracking.controller';
import { MealTrackingService } from './application/meal-tracking.service';
import { MealTrackingRepository } from './infrastructure/meal-tracking.repository';

@Module({
  imports: [DatabaseModule, MealPlanModule],
  controllers: [MealTrackingController],
  providers: [MealTrackingService, MealTrackingRepository],
  exports: [MealTrackingService],
})
export class MealTrackingModule {}
