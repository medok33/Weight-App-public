import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MealPlanModule } from '../meal-plan/meal-plan.module';
import { MealTrackingModule } from '../meal-tracking/meal-tracking.module';
import { ProgressModule } from '../progress/progress.module';
import { ShoppingListModule } from '../shopping-list/shopping-list.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { WorkoutEngineModule } from '../workout-engine/workout-engine.module';
import { AIAssistantService, AI_PROVIDER } from './application/ai-assistant.service';
import { AIChatService } from './application/ai-chat.service';
import { AIContextBuilder } from './application/ai-context.builder';
import { AITariffService } from './application/ai-tariff.service';
import { AIMetricsService } from './application/ai-metrics.service';
import { AIUserContextService } from './application/ai-user-context.service';
import { AIAssistantController } from './controllers/ai-assistant.controller';
import { AIAssistantRepository } from './infrastructure/ai-assistant.repository';
import { createAIProvider } from './providers/ai-provider.factory';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    UserProfileModule,
    MealPlanModule,
    MealTrackingModule,
    WorkoutEngineModule,
    ShoppingListModule,
    ProgressModule,
  ],
  controllers: [AIAssistantController],
  providers: [
    AIAssistantService,
    AIChatService,
    AIContextBuilder,
    AITariffService,
    AIMetricsService,
    AIUserContextService,
    AIAssistantRepository,
    { provide: AI_PROVIDER, useFactory: () => createAIProvider() },
  ],
  exports: [AIAssistantService, AIChatService, AIContextBuilder, AITariffService, AIMetricsService, AIUserContextService],
})
export class AIAssistantModule {}
