import "reflect-metadata";

import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { EligibilityModule } from "./modules/eligibility/eligibility.module";
import { NutritionEngineModule } from "./modules/nutrition-engine/nutrition-engine.module";
import { ProductCatalogModule } from "./modules/product-catalog/product-catalog.module";
import { RecipeCatalogModule } from "./modules/recipe-catalog/recipe-catalog.module";
import { WorkoutEngineModule } from "./modules/workout-engine/workout-engine.module";
import { OwnerAdminModule } from "./modules/owner-admin/owner-admin.module";
import { ProductAdminModule } from "./modules/product-admin/product-admin.module";
import { RecipePlatformModule } from "./modules/recipe-platform/recipe-platform.module";
import { MealPlanModule } from "./modules/meal-plan/meal-plan.module";
import { ShoppingListModule } from "./modules/shopping-list/shopping-list.module";
import { PriceIntelligenceModule } from "./modules/price-intelligence/price-intelligence.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { DashboardTodayModule } from "./modules/dashboard-today/dashboard-today.module";
import { ProgressModule } from "./modules/progress/progress.module";
import { RevisionEngineModule } from "./modules/revision-engine/revision-engine.module";
import { AIAssistantModule } from "./modules/ai-assistant/ai-assistant.module";
import { AuditSecurityModule } from "./modules/audit-security/audit-security.module";
import { ObservabilityModule } from "./modules/observability/observability.module";
import { RetentionModule } from "./modules/retention/retention.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { PantryModule } from "./modules/pantry/pantry.module";
import { BudgetModeModule } from "./modules/budget-mode/budget-mode.module";
import { FamilyModeModule } from "./modules/family-mode/family-mode.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { EntitlementsModule } from "./modules/entitlements/entitlements.module";
import { ExportShareModule } from "./modules/export-share/export-share.module";
import { UserProfileModule } from "./modules/user-profile/user-profile.module";
import { MealTrackingModule } from "./modules/meal-tracking/meal-tracking.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { ActivityModule } from "./modules/activity/activity.module";
import { logAIProviderStartupStatus } from "./modules/ai-assistant/providers/ai-provider.env";
import { SecurityHeadersMiddleware } from "./modules/audit-security/infrastructure/security-headers.middleware";
import { assertBrowserSecurityConfigAtStartup } from "./modules/auth/domain/browser-security.config";
import { assertActivityStaleHoursConfigAtStartup } from "./modules/activity/domain/activity.types";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HealthModule,
    ActivityModule,
    EligibilityModule,
    NutritionEngineModule,
    ProductCatalogModule,
    RecipeCatalogModule,
    WorkoutEngineModule,
    OwnerAdminModule,
    ProductAdminModule,
    RecipePlatformModule,
    MealPlanModule,
    MealTrackingModule,
    ShoppingListModule,
    PriceIntelligenceModule,
    IntegrationsModule,
    DashboardTodayModule,
    ProgressModule,
    RevisionEngineModule,
    AIAssistantModule,
    AuditSecurityModule,
    ObservabilityModule,
    RetentionModule,
    PlatformModule,
    PantryModule,
    BudgetModeModule,
    FamilyModeModule,
    PaymentsModule,
    EntitlementsModule,
    ExportShareModule,
    UserProfileModule,
  ],
})
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityHeadersMiddleware).forRoutes("*");
  }
}

async function bootstrap(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required');
  }
  const appEnv = String(process.env.APP_ENV ?? '').trim().toUpperCase();
  if ((appEnv === 'STAGING' || appEnv === 'PRODUCTION') && process.env.OWNER_BOOTSTRAP_ENABLED === 'true') {
    throw new Error('OWNER_BOOTSTRAP_ENABLED must not be true in STAGING/PRODUCTION');
  }
  const browserSecurity = assertBrowserSecurityConfigAtStartup();
  assertActivityStaleHoursConfigAtStartup();
  logAIProviderStartupStatus();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.enableCors({
    origin: browserSecurity.allowedOrigins,
    credentials: true,
  });
  app.setGlobalPrefix("api/v1");
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
