import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AuditSecurityModule } from '../audit-security/audit-security.module';
import { ProductCatalogModule } from '../product-catalog/product-catalog.module';
import { RecipeContentResolver } from './application/recipe-content.resolver';
import { RecipeDependencyImpactService } from './application/recipe-dependency-impact.service';
import { RecipeFamilyService } from './application/recipe-family.service';
import { RecipeFingerprintService } from './application/recipe-fingerprint.service';
import { RecipeLifecycleService } from './application/recipe-lifecycle.service';
import { RecipeMediaService } from './application/recipe-media.service';
import { RecipeProductDependencyService } from './application/recipe-product-dependency.service';
import { RecipeCoverageAnalyzer } from './application/recipe-coverage-analyzer.service';
import { RecipeCoverageScheduler } from './application/recipe-coverage-scheduler.service';
import { RecipeCoverageService } from './application/recipe-coverage.service';
import { RecipeSearchBeforeGenerateService } from './application/recipe-search-before-generate.service';
import { RecipeAdminWorkspaceService } from './application/recipe-admin-workspace.service';
import { RecipeVersionService } from './application/recipe-version.service';
import { RecipeExternalSourceService } from './application/recipe-external-source.service';
import { RecipeResearchService } from './application/recipe-research.service';
import { RecipeSourceAdapterRegistry } from './application/recipe-source-adapter.registry';
import { RecipePlatformAdminController } from './controllers/recipe-platform-admin.controller';
import { RecipeSourceAdminController } from './controllers/recipe-source-admin.controller';
import { RecipeResearchAdminController } from './controllers/recipe-research-admin.controller';
import { CHEF_EDITOR_PROVIDER, ChefEditorService, DeterministicChefEditorProvider } from './application/chef-editor.service';
import { RecipeAuthoringPersistence } from './application/recipe-authoring.persistence';
import { RecipePublicationService } from './application/recipe-publication.service';
import { RecipeQualityOrchestrator } from './application/recipe-quality.orchestrator';
import { RecipeSynthesisBriefApprovalService } from './application/recipe-synthesis-brief-approval.service';

@Module({
  imports: [DatabaseModule, AuthModule, ProductCatalogModule, AuditSecurityModule],
  controllers: [RecipePlatformAdminController, RecipeSourceAdminController, RecipeResearchAdminController],
  providers: [
    RecipeCoverageAnalyzer,
    RecipeVersionService,
    RecipeFamilyService,
    RecipeContentResolver,
    RecipeLifecycleService,
    RecipeProductDependencyService,
    RecipeDependencyImpactService,
    RecipeFingerprintService,
    RecipeMediaService,
    RecipeCoverageService,
    RecipeCoverageScheduler,
    RecipeSearchBeforeGenerateService,
    RecipeAdminWorkspaceService,
    RecipeSourceAdapterRegistry,
    RecipeExternalSourceService,
    RecipeResearchService,
    { provide: CHEF_EDITOR_PROVIDER, useFactory: () => new DeterministicChefEditorProvider() },
    ChefEditorService,
    RecipeAuthoringPersistence,
    RecipePublicationService,
    RecipeQualityOrchestrator,
    RecipeSynthesisBriefApprovalService,
  ],
  exports: [
    RecipeVersionService,
    RecipeFamilyService,
    RecipeContentResolver,
    RecipeLifecycleService,
    RecipeProductDependencyService,
    RecipeDependencyImpactService,
    RecipeFingerprintService,
    RecipeMediaService,
    RecipeCoverageService,
    RecipeCoverageAnalyzer,
    RecipeSearchBeforeGenerateService,
    RecipeAdminWorkspaceService,
    RecipeSourceAdapterRegistry,
    RecipeExternalSourceService,
    RecipeResearchService,
    ChefEditorService,
    RecipeAuthoringPersistence,
    RecipePublicationService,
    RecipeQualityOrchestrator,
    RecipeSynthesisBriefApprovalService,
  ],
})
export class RecipePlatformModule {}
