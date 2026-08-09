import { Module } from '@nestjs/common';
import { MealPlanModule } from '../meal-plan/meal-plan.module';
import { WorkoutEngineModule } from '../workout-engine/workout-engine.module';
import { MealTrackingModule } from '../meal-tracking/meal-tracking.module';
import { ShoppingListModule } from '../shopping-list/shopping-list.module';
import { DashboardTodayController } from './controllers/dashboard-today.controller';
import { DashboardTodayService } from './application/dashboard-today.service';

@Module({
  imports: [MealPlanModule, WorkoutEngineModule, MealTrackingModule, ShoppingListModule],
  controllers: [DashboardTodayController],
  providers: [DashboardTodayService],
  exports: [DashboardTodayService],
})
export class DashboardTodayModule {}
