import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MealPlanModule } from '../meal-plan/meal-plan.module';
import { PriceIntelligenceModule } from '../price-intelligence/price-intelligence.module';
import { ShoppingListController } from './controllers/shopping-list.controller';
import { ShoppingListService } from './application/shopping-list.service';
import { ShoppingListRepository } from './infrastructure/shopping-list.repository';

@Module({
  imports: [DatabaseModule, PriceIntelligenceModule, forwardRef(() => MealPlanModule)],
  controllers: [ShoppingListController],
  providers: [ShoppingListService, ShoppingListRepository],
  exports: [ShoppingListService],
})
export class ShoppingListModule {}
