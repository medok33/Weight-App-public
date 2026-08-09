import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { PantryModule } from '../pantry/pantry.module';
import { ProductCatalogModule } from '../product-catalog/product-catalog.module';
import { RecipePlatformModule } from '../recipe-platform/recipe-platform.module';
import { RevisionEngineModule } from '../revision-engine/revision-engine.module';
import { ShoppingListModule } from '../shopping-list/shopping-list.module';
import { AuditSecurityModule } from '../audit-security/audit-security.module';
import { MealPlanController } from './controllers/meal-plan.controller';
import { MealPlanService } from './application/meal-plan.service';
import { MealDishDetailService } from './application/meal-dish-detail.service';
import { MealSubstitutionService } from './application/meal-substitution.service';
import { MealPlanRepository } from './infrastructure/meal-plan.repository';
import { MealDishCatalogRepository } from './infrastructure/meal-dish-catalog.repository';

@Module({
  imports: [
    DatabaseModule,
    UserProfileModule,
    AuditSecurityModule,
    ProductCatalogModule,
    RecipePlatformModule,
    RevisionEngineModule,
    forwardRef(() => PantryModule),
    forwardRef(() => ShoppingListModule),
  ],
  controllers: [MealPlanController],
  providers: [
    MealPlanService,
    MealPlanRepository,
    MealDishDetailService,
    MealDishCatalogRepository,
    MealSubstitutionService,
  ],
  exports: [MealPlanService, MealPlanRepository, MealDishDetailService, MealSubstitutionService],
})
export class MealPlanModule {}
