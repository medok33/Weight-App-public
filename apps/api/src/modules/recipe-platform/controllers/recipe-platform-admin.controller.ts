import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { OwnerMfaGuard } from '../../auth/guards/owner-mfa.guard';
import { RequireRecentOwnerReauth } from '../../auth/decorators/require-recent-owner-reauth.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { RecipeDependencyImpactService } from '../application/recipe-dependency-impact.service';
import { RecipeFamilyService } from '../application/recipe-family.service';
import { RecipeFingerprintService } from '../application/recipe-fingerprint.service';
import { RecipeLifecycleService } from '../application/recipe-lifecycle.service';
import { RecipeMediaService } from '../application/recipe-media.service';
import { RecipeCoverageService } from '../application/recipe-coverage.service';
import { RecipeCoverageAnalyzer } from '../application/recipe-coverage-analyzer.service';
import { RecipeSearchBeforeGenerateService } from '../application/recipe-search-before-generate.service';
import { RecipeProductDependencyService } from '../application/recipe-product-dependency.service';
import { RecipeAdminWorkspaceService } from '../application/recipe-admin-workspace.service';
import { RecipeVersionService } from '../application/recipe-version.service';
import { assertNoClientControlledSearchFields } from '../domain/recipe-search-before-generate.policy';
import { isRecipeDataClass } from '../domain/recipe-data-class.policy';

@Controller()
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles('OWNER', 'ADMIN')
export class RecipePlatformAdminController {
  constructor(
    @Inject(RecipeVersionService) private readonly versions: RecipeVersionService,
    @Inject(RecipeFamilyService) private readonly families: RecipeFamilyService,
    @Inject(RecipeLifecycleService) private readonly lifecycle: RecipeLifecycleService,
    @Inject(RecipeProductDependencyService) private readonly dependencies: RecipeProductDependencyService,
    @Inject(RecipeDependencyImpactService) private readonly impact: RecipeDependencyImpactService,
    @Inject(RecipeFingerprintService) private readonly fingerprints: RecipeFingerprintService,
    @Inject(RecipeMediaService) private readonly media: RecipeMediaService,
    @Inject(RecipeCoverageService) private readonly coverage: RecipeCoverageService,
    @Inject(RecipeCoverageAnalyzer) private readonly coverageAnalyzer: RecipeCoverageAnalyzer,
    @Inject(RecipeSearchBeforeGenerateService)
    private readonly recipeSearch: RecipeSearchBeforeGenerateService,
    @Inject(RecipeAdminWorkspaceService) private readonly workspace: RecipeAdminWorkspaceService,
  ) {}

  private actor(user: RequestUser) {
    const id = user.id;
    if (!id) throw new UnauthorizedException('AUTH_REQUIRED');
    return { id, role: String(user.role ?? '') };
  }

  private mapError(error: unknown): never {
    const message = error instanceof Error ? error.message : 'RECIPE_PLATFORM_ERROR';
    if (message === 'OWNER_ACCESS_FORBIDDEN') throw new UnauthorizedException(message);
    if (message === 'COVERAGE_ANALYSIS_ALREADY_RUNNING') throw new ForbiddenException(message);
    if (
      message === 'RECIPE_NOT_FOUND' ||
      message === 'RECIPE_VERSION_NOT_FOUND' ||
      message === 'RECIPE_FAMILY_NOT_FOUND' ||
      message === 'RECIPE_LIFECYCLE_NOT_FOUND' ||
      message === 'REVALIDATION_TASK_NOT_FOUND' ||
      message === 'DUPLICATE_CANDIDATE_NOT_OPEN' ||
      message === 'MEDIA_NOT_FOUND' ||
      message === 'MEDIA_LINK_NOT_FOUND' ||
      message === 'COVERAGE_SLOT_NOT_FOUND' ||
      message === 'COVERAGE_RUN_NOT_FOUND' ||
      message === 'SEARCH_RUN_NOT_FOUND' ||
      message === 'SEARCH_DECISION_NOT_FOUND'
    ) {
      throw new NotFoundException(message);
    }
    if (
      message === 'RECIPE_VERSION_IMMUTABLE' ||
      message === 'RECIPE_VERSION_NO_INGREDIENTS' ||
      message === 'RECIPE_VERSION_INVALID_SERVINGS' ||
      message === 'RECIPE_VERSION_INVALID_UNIT_OR_AMOUNT' ||
      message === 'DUPLICATE_RECIPE_CONFLICT' ||
      message === 'NEAR_DUPLICATE_ACK_REQUIRED' ||
      message === 'MEDIA_PUBLICATION_BLOCKED' ||
      message === 'RECIPE_VERSION_MEDIA_IMMUTABLE' ||
      message.startsWith('RECIPE_LIFECYCLE_') ||
      message.startsWith('REVALIDATION_') ||
      message.startsWith('RECIPE_FINGERPRINT_') ||
      message.startsWith('DUPLICATE_') ||
      message.startsWith('MEDIA_') ||
      message.startsWith('COVERAGE_') ||
      message.startsWith('SEARCH_')
    ) {
      const payload =
        error && typeof error === 'object'
          ? {
              code: message,
              message,
              candidates: (error as { candidates?: unknown }).candidates ?? undefined,
              reason: (error as { reason?: unknown }).reason ?? undefined,
              mediaAssetId: (error as { mediaAssetId?: unknown }).mediaAssetId ?? undefined,
            }
          : message;
      throw new ForbiddenException(payload);
    }
    throw error instanceof Error ? error : new Error(message);
  }

  @Get('admin/content/overview')
  async contentOverview() {
    return this.workspace.contentOverview();
  }

  @Get('admin/recipes')
  async listRecipes(
    @Query('q') q?: string,
    @Query('dataClass') dataClass?: string,
    @Query('lifecycle') lifecycle?: string,
    @Query('validation') validation?: string,
    @Query('familyAssigned') familyAssigned?: string,
    @Query('currentPublished') currentPublished?: string,
    @Query('duplicateBlocker') duplicateBlocker?: string,
    @Query('revalidationOpen') revalidationOpen?: string,
    @Query('mediaMissing') mediaMissing?: string,
    @Query('coverageAssigned') coverageAssigned?: string,
    @Query('fingerprintMissing') fingerprintMissing?: string,
    @Query('dependencyUnresolved') dependencyUnresolved?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('legacy') legacy?: string,
  ) {
    // Backward-compatible unfiltered list when explicitly requested.
    if (legacy === '1' || legacy === 'true') {
      return {
        items: await this.versions.listRecipes(),
        currentVersionSemantics: 'B_CURRENT_IS_PUBLISHED',
      };
    }
    try {
      const catalog = await this.workspace.listCatalog({
        q,
        dataClass,
        lifecycle,
        validation,
        familyAssigned: (familyAssigned as 'yes' | 'no' | '') || '',
        currentPublished: (currentPublished as 'yes' | 'no' | '') || '',
        duplicateBlocker: (duplicateBlocker as 'yes' | '') || '',
        revalidationOpen: (revalidationOpen as 'yes' | '') || '',
        mediaMissing: (mediaMissing as 'yes' | '') || '',
        coverageAssigned: (coverageAssigned as 'yes' | 'no' | '') || '',
        fingerprintMissing: (fingerprintMissing as 'yes' | '') || '',
        dependencyUnresolved: (dependencyUnresolved as 'yes' | '') || '',
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 25,
        sort,
        order: order === 'desc' ? 'desc' : 'asc',
      });
      return { ...catalog, currentVersionSemantics: 'B_CURRENT_IS_PUBLISHED' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RECIPE_CATALOG_FAILED';
      if (message === 'RECIPE_DATA_CLASS_FILTER_INVALID') throw new ForbiddenException(message);
      throw error;
    }
  }

  @Get('admin/recipes/:id/workspace')
  async recipeWorkspace(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    const data = await this.workspace.getRecipeWorkspace(id, user.role);
    if (!data) throw new NotFoundException('RECIPE_NOT_FOUND');
    return data;
  }

  @Get('admin/recipes/:id/versions/:versionId/workspace')
  async versionWorkspace(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const data = await this.workspace.getVersionWorkspace(id, versionId, user.role);
    if (!data) throw new NotFoundException('RECIPE_VERSION_NOT_FOUND');
    return data;
  }

  @Get('admin/recipe-coverage/board')
  async coverageBoard(
    @Query('matrixVersion') matrixVersion?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('mealType') mealType?: string,
    @Query('primaryProductId') primaryProductId?: string,
    @Query('dishType') dishType?: string,
    @Query('cookingMethod') cookingMethod?: string,
    @Query('dietaryProfile') dietaryProfile?: string,
    @Query('equipment') equipment?: string,
    @Query('hasAssignments') hasAssignments?: string,
    @Query('hasAmbiguous') hasAmbiguous?: string,
    @Query('dirty') dirty?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.workspace.getCoverageBoard({
      matrixVersion,
      status,
      priority,
      mealType,
      primaryProductId,
      dishType,
      cookingMethod,
      dietaryProfile,
      equipment,
      hasAssignments,
      hasAmbiguous,
      dirty,
      q,
      limit: limit ? Number(limit) : 60,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Patch('admin/recipes/:id/data-class')
  async classifyRecipe(
    @Param('id') id: string,
    @Body() body: { dataClass?: string; reason?: string },
    @CurrentUser() user: RequestUser,
  ) {
    if (!isRecipeDataClass(body?.dataClass)) throw new ForbiddenException('RECIPE_DATA_CLASS_INVALID');
    return this.workspace.classifyRecipe({
      recipeId: id,
      dataClass: body.dataClass,
      actorUserId: user.id,
      actorRole: user.role,
      reason: body.reason,
    });
  }

  @Post('admin/recipes/clone')
  async cloneRecipe(
    @CurrentUser() user: RequestUser,
    @Body() body: { sourceRecipeId?: string; name?: string },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.sourceRecipeId || !body?.name) throw new Error('RECIPE_CLONE_INVALID');
      return await this.versions.cloneRecipeShell({
        sourceRecipeId: body.sourceRecipeId,
        name: body.name,
        actorUserId: actor.id,
        actorRole: actor.role,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipes/:id/versions')
  async listVersions(@Param('id') recipeId: string) {
    return { items: await this.versions.listVersions(recipeId) };
  }

  @Get('admin/recipes/:id/versions/:versionId')
  async getVersion(@Param('id') recipeId: string, @Param('versionId') versionId: string) {
    const row = await this.versions.getVersion(recipeId, versionId);
    if (!row) throw new NotFoundException('RECIPE_VERSION_NOT_FOUND');
    return row;
  }

  @Post('admin/recipes/:id/versions')
  async createVersion(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Body() body: { changeReason?: string; publish?: boolean },
  ) {
    try {
      const actor = this.actor(user);
      return await this.versions.createVersion({
        recipeId,
        actorUserId: actor.id,
        actorRole: actor.role,
        changeReason: body?.changeReason,
        publish: body?.publish !== false,
        // versionNumber / checksum / approvedBy are server-owned — ignore mass assignment.
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipes/:id/versions/:versionId/publish')
  @RequireRecentOwnerReauth()
  async publish(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body()
    body?: {
      acknowledgeNearDuplicate?: boolean;
      overrideExactDuplicate?: boolean;
      overrideReason?: string;
    },
  ) {
    try {
      const actor = this.actor(user);
      return await this.versions.publishVersion({
        recipeId,
        versionId,
        actorUserId: actor.id,
        actorRole: actor.role,
        acknowledgeNearDuplicate: body?.acknowledgeNearDuplicate,
        overrideExactDuplicate: body?.overrideExactDuplicate,
        overrideReason: body?.overrideReason,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-families')
  async listFamilies() {
    return { items: await this.families.list() };
  }

  @Post('admin/recipe-families')
  async createFamily(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      canonicalName?: string;
      slug?: string;
      dishType?: string;
      primaryProductId?: string | null;
    },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.canonicalName || !body?.slug) throw new Error('RECIPE_FAMILY_INVALID');
      return await this.families.create({
        actorUserId: actor.id,
        actorRole: actor.role,
        canonicalName: body.canonicalName,
        slug: body.slug,
        dishType: body.dishType,
        primaryProductId: body.primaryProductId,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch('admin/recipe-families/:id')
  async patchFamily(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body()
    body: {
      canonicalName?: string;
      dishType?: string;
      primaryProductId?: string | null;
      status?: 'ACTIVE' | 'ARCHIVED';
    },
  ) {
    try {
      const actor = this.actor(user);
      return await this.families.patch(id, {
        actorUserId: actor.id,
        actorRole: actor.role,
        ...body,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipes/:id/family')
  async assignFamily(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Body() body: { recipeFamilyId?: string | null },
  ) {
    try {
      const actor = this.actor(user);
      return await this.families.assignRecipe({
        actorUserId: actor.id,
        actorRole: actor.role,
        recipeId,
        recipeFamilyId: body?.recipeFamilyId ?? null,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-platform/backfill-families')
  async backfillFamilies(@CurrentUser() user: RequestUser) {
    try {
      const actor = this.actor(user);
      const family = await this.versions.ensureDeterministicFamilies(actor.id);
      const report = await this.versions.buildBackfillReport();
      return { family, report };
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipes/:id')
  async getRecipeSummary(@Param('id') recipeId: string) {
    const versions = await this.versions.listVersions(recipeId);
    return {
      recipeId,
      currentVersionSemantics: 'B_CURRENT_IS_PUBLISHED',
      suspendFallbackPolicy: this.lifecycle.suspendFallbackPolicy,
      versions,
    };
  }

  @Get('admin/recipes/:id/versions/:versionId/lifecycle')
  async getLifecycle(@Param('id') recipeId: string, @Param('versionId') versionId: string) {
    const version = await this.versions.getVersion(recipeId, versionId);
    if (!version) throw new NotFoundException('RECIPE_VERSION_NOT_FOUND');
    const lifecycle = await this.lifecycle.getLifecycle(versionId);
    const events = await this.lifecycle.listEvents(versionId);
    const deps = await this.dependencies.listForVersion(versionId);
    return {
      recipeId,
      versionId,
      lifecycle,
      events,
      dependencyCount: deps.length,
      unresolvedDependencies: deps.filter((d) => d.resolutionStatus !== 'RESOLVED').length,
      suspendFallbackPolicy: this.lifecycle.suspendFallbackPolicy,
    };
  }

  @Post('admin/recipes/:id/versions/:versionId/submit')
  async submit(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body() body: { reasonText?: string },
  ) {
    try {
      const actor = this.actor(user);
      return await this.lifecycle.submitForReview({
        recipeId,
        versionId,
        actorUserId: actor.id,
        actorRole: actor.role,
        reasonText: body?.reasonText,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipes/:id/versions/:versionId/approve')
  @RequireRecentOwnerReauth()
  async approve(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body() body: { reasonText?: string },
  ) {
    try {
      const actor = this.actor(user);
      return await this.lifecycle.approve({
        recipeId,
        versionId,
        actorUserId: actor.id,
        actorRole: actor.role,
        reasonText: body?.reasonText,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipes/:id/versions/:versionId/reject')
  @RequireRecentOwnerReauth()
  async reject(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body() body: { reasonCode?: string; reasonText?: string },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.reasonCode) throw new Error('RECIPE_LIFECYCLE_REASON_REQUIRED');
      return await this.lifecycle.reject({
        recipeId,
        versionId,
        actorUserId: actor.id,
        actorRole: actor.role,
        reasonCode: body.reasonCode,
        reasonText: body.reasonText,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipes/:id/versions/:versionId/suspend')
  @RequireRecentOwnerReauth()
  async suspend(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body() body: { reasonCode?: string; reasonText?: string },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.reasonCode) throw new Error('RECIPE_LIFECYCLE_REASON_REQUIRED');
      return await this.lifecycle.suspend({
        recipeId,
        versionId,
        actorUserId: actor.id,
        actorRole: actor.role,
        reasonCode: body.reasonCode,
        reasonText: body.reasonText,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipes/:id/versions/:versionId/archive')
  @RequireRecentOwnerReauth()
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body() body: { reasonCode?: string; reasonText?: string },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.reasonCode) throw new Error('RECIPE_LIFECYCLE_REASON_REQUIRED');
      return await this.lifecycle.archive({
        recipeId,
        versionId,
        actorUserId: actor.id,
        actorRole: actor.role,
        reasonCode: body.reasonCode,
        reasonText: body.reasonText,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipes/:id/versions/:versionId/restore')
  @RequireRecentOwnerReauth()
  async restore(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body() body: { reasonCode?: string; reasonText?: string },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.reasonCode) throw new Error('RECIPE_LIFECYCLE_REASON_REQUIRED');
      return await this.lifecycle.restore({
        recipeId,
        versionId,
        actorUserId: actor.id,
        actorRole: actor.role,
        reasonCode: body.reasonCode,
        reasonText: body.reasonText,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipes/:id/versions/:versionId/dependencies')
  async listDependencies(@Param('id') recipeId: string, @Param('versionId') versionId: string) {
    const version = await this.versions.getVersion(recipeId, versionId);
    if (!version) throw new NotFoundException('RECIPE_VERSION_NOT_FOUND');
    return { items: await this.dependencies.listForVersion(versionId) };
  }

  @Get('admin/recipe-revalidation')
  async listRevalidation(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('reason') reasonCode?: string,
    @Query('productId') productId?: string,
    @Query('recipeVersionId') recipeVersionId?: string,
  ) {
    return {
      items: await this.impact.listTasks({
        status,
        severity,
        reasonCode,
        productId,
        recipeVersionId,
      }),
    };
  }

  @Get('admin/recipe-revalidation/:taskId')
  async getRevalidation(@Param('taskId') taskId: string) {
    const row = await this.impact.getTask(taskId);
    if (!row) throw new NotFoundException('REVALIDATION_TASK_NOT_FOUND');
    return row;
  }

  @Post('admin/recipe-revalidation/:taskId/resolve')
  async resolveRevalidation(
    @CurrentUser() user: RequestUser,
    @Param('taskId') taskId: string,
    @Body()
    body: {
      resolutionCode?:
        | 'CONFIRM_CURRENT_VERSION'
        | 'CREATE_CORRECTED_VERSION'
        | 'SUSPEND_VERSION'
        | 'ARCHIVE_VERSION'
        | 'DISMISS';
      resolutionNote?: string;
    },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.resolutionCode || !body?.resolutionNote) {
        throw new Error('REVALIDATION_REASON_REQUIRED');
      }
      return await this.impact.resolveTask({
        taskId,
        actorUserId: actor.id,
        actorRole: actor.role,
        resolutionCode: body.resolutionCode,
        resolutionNote: body.resolutionNote,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipes/:id/versions/:versionId/fingerprint')
  async getFingerprint(@Param('id') recipeId: string, @Param('versionId') versionId: string) {
    const version = await this.versions.getVersion(recipeId, versionId);
    if (!version) throw new NotFoundException('RECIPE_VERSION_NOT_FOUND');
    const fingerprint = await this.fingerprints.ensureFingerprint(versionId);
    return { recipeId, versionId, fingerprint, schemaVersion: this.fingerprints.schemaVersion };
  }

  @Post('admin/recipes/:id/versions/:versionId/fingerprint/rebuild')
  async rebuildFingerprint(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body() body?: { schemaVersion?: string },
  ) {
    try {
      const actor = this.actor(user);
      const version = await this.versions.getVersion(recipeId, versionId);
      if (!version) throw new NotFoundException('RECIPE_VERSION_NOT_FOUND');
      return await this.fingerprints.rebuild({
        recipeVersionId: versionId,
        actorUserId: actor.id,
        actorRole: actor.role,
        schemaVersion: body?.schemaVersion,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-duplicates')
  async listDuplicates(
    @Query('status') status?: string,
    @Query('classification') classification?: string,
    @Query('schemaVersion') schemaVersion?: string,
  ) {
    return {
      items: await this.fingerprints.listCandidates({ status, classification, schemaVersion }),
    };
  }

  @Get('admin/recipe-duplicates/:candidateId')
  async getDuplicate(@Param('candidateId') candidateId: string) {
    const row = await this.fingerprints.getCandidate(candidateId);
    if (!row) throw new NotFoundException('DUPLICATE_CANDIDATE_NOT_FOUND');
    return row;
  }

  @Post('admin/recipe-duplicates/:candidateId/resolve')
  async resolveDuplicate(
    @CurrentUser() user: RequestUser,
    @Param('candidateId') candidateId: string,
    @Body()
    body: {
      resolutionCode?: 'CONFIRMED_DUPLICATE' | 'CONFIRMED_VARIANT' | 'DISMISSED' | 'RESOLVED';
      resolutionNote?: string;
    },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.resolutionCode || !body?.resolutionNote) {
        throw new Error('DUPLICATE_RESOLUTION_REASON_REQUIRED');
      }
      return await this.fingerprints.resolveCandidate({
        candidateId,
        actorUserId: actor.id,
        actorRole: actor.role,
        resolutionCode: body.resolutionCode,
        resolutionNote: body.resolutionNote,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-fingerprints/backfill')
  async backfillFingerprints(@CurrentUser() user: RequestUser) {
    try {
      const actor = this.actor(user);
      const fingerprint = await this.fingerprints.backfillAll(actor.id);
      const media = await this.media.mediaBackfillReport();
      return { fingerprint, media };
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/media')
  async listMedia(
    @Query('sourceType') sourceType?: string,
    @Query('rightsStatus') rightsStatus?: string,
    @Query('moderationStatus') moderationStatus?: string,
    @Query('licenseType') licenseType?: string,
  ) {
    return {
      items: await this.media.listAssets({ sourceType, rightsStatus, moderationStatus, licenseType }),
      storageConfigured: this.media.storageConfigured,
      externalUrlPolicy: this.media.externalUrlPolicy,
    };
  }

  @Post('admin/media')
  async registerMedia(@CurrentUser() user: RequestUser, @Body() body: Record<string, unknown>) {
    try {
      const actor = this.actor(user);
      return await this.media.registerMetadata({
        actorUserId: actor.id,
        actorRole: actor.role,
        sourceType: body.sourceType as never,
        licenseType: body.licenseType as never,
        sourceUrl: (body.sourceUrl as string) ?? null,
        sourceReference: (body.sourceReference as string) ?? null,
        rightsHolder: (body.rightsHolder as string) ?? null,
        licenseUrl: (body.licenseUrl as string) ?? null,
        attributionText: (body.attributionText as string) ?? null,
        originalFilename: (body.originalFilename as string) ?? null,
        mimeType: (body.mimeType as string) ?? null,
        width: body.width == null ? null : Number(body.width),
        height: body.height == null ? null : Number(body.height),
        sizeBytes: body.sizeBytes == null ? null : Number(body.sizeBytes),
        checksumSha256: (body.checksumSha256 as string) ?? null,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/media/:id')
  async getMedia(@Param('id') id: string) {
    const row = await this.media.getAsset(id);
    if (!row) throw new NotFoundException('MEDIA_NOT_FOUND');
    return row;
  }

  @Patch('admin/media/:id/rights')
  async patchMediaRights(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.rightsStatus) throw new Error('MEDIA_RIGHTS_STATUS_REQUIRED');
      return await this.media.patchRights({
        mediaId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        rightsStatus: body.rightsStatus as never,
        licenseType: body.licenseType as never,
        attributionText: (body.attributionText as string) ?? null,
        rightsValidUntil: (body.rightsValidUntil as string) ?? null,
        reason: (body.reason as string) ?? undefined,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch('admin/media/:id/moderation')
  async patchMediaModeration(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { moderationStatus?: string; reason?: string },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.moderationStatus) throw new Error('MEDIA_MODERATION_STATUS_REQUIRED');
      return await this.media.patchModeration({
        mediaId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        moderationStatus: body.moderationStatus as never,
        reason: body.reason,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/media/:id/takedown')
  async takedownMedia(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.reason) throw new Error('MEDIA_TAKEDOWN_REASON_REQUIRED');
      return await this.media.takedown({
        mediaId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason: body.reason,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipes/:id/versions/:versionId/media')
  async listVersionMedia(@Param('id') recipeId: string, @Param('versionId') versionId: string) {
    const version = await this.versions.getVersion(recipeId, versionId);
    if (!version) throw new NotFoundException('RECIPE_VERSION_NOT_FOUND');
    return { items: await this.media.listForVersion(versionId) };
  }

  @Post('admin/recipes/:id/versions/:versionId/media')
  async linkVersionMedia(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Body()
    body: {
      mediaAssetId?: string;
      role?: string;
      position?: number;
      altText?: string;
      caption?: string;
      stepIndex?: number;
    },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.mediaAssetId || !body?.role || !body?.altText) throw new Error('MEDIA_LINK_INVALID');
      return await this.media.linkToVersion({
        recipeId,
        versionId,
        mediaAssetId: body.mediaAssetId,
        role: body.role as never,
        position: body.position,
        altText: body.altText,
        caption: body.caption,
        stepIndex: body.stepIndex,
        actorUserId: actor.id,
        actorRole: actor.role,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Delete('admin/recipes/:id/versions/:versionId/media/:linkId')
  @RequireRecentOwnerReauth()
  async unlinkVersionMedia(
    @CurrentUser() user: RequestUser,
    @Param('id') recipeId: string,
    @Param('versionId') versionId: string,
    @Param('linkId') linkId: string,
  ) {
    try {
      const actor = this.actor(user);
      return await this.media.unlinkFromVersion({
        recipeId,
        versionId,
        linkId,
        actorUserId: actor.id,
        actorRole: actor.role,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-coverage/slots')
  async listCoverageSlots(
    @Query('mealType') mealType?: string,
    @Query('priority') priority?: string,
    @Query('status') status?: string,
    @Query('matrixVersion') matrixVersion?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.coverage.listSlots({
      mealType,
      priority,
      status,
      matrixVersion,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Post('admin/recipe-coverage/slots')
  async createCoverageSlot(@CurrentUser() user: RequestUser, @Body() body: Record<string, unknown>) {
    try {
      const actor = this.actor(user);
      if (!body?.name || !body?.mealType || !body?.dishType || !body?.dietaryProfile || !body?.equipmentProfile) {
        throw new Error('COVERAGE_SLOT_INVALID');
      }
      if (body.publishedRecipeCount != null) throw new Error('COVERAGE_PUBLISHED_COUNT_SERVER_OWNED');
      if (body.matrixVersion && body.matrixVersion !== this.coverage.matrixVersion) {
        throw new Error('COVERAGE_MATRIX_VERSION_UNSUPPORTED');
      }
      return await this.coverage.createSlot({
        actorUserId: actor.id,
        actorRole: actor.role,
        name: String(body.name),
        description: body.description == null ? undefined : String(body.description),
        mealType: String(body.mealType),
        primaryProductId: (body.primaryProductId as string) ?? null,
        dishType: String(body.dishType),
        cookingMethod: (body.cookingMethod as string) ?? null,
        calorieMin: body.calorieMin == null ? null : Number(body.calorieMin),
        calorieMax: body.calorieMax == null ? null : Number(body.calorieMax),
        proteinMin: body.proteinMin == null ? null : Number(body.proteinMin),
        fatMax: body.fatMax == null ? null : Number(body.fatMax),
        maximumTimeMinutes: body.maximumTimeMinutes == null ? null : Number(body.maximumTimeMinutes),
        maximumCost: body.maximumCost == null ? null : Number(body.maximumCost),
        currency: (body.currency as string) ?? null,
        dietaryProfile: String(body.dietaryProfile),
        equipmentProfile: String(body.equipmentProfile),
        desiredRecipeCount: Number(body.desiredRecipeCount ?? 1),
        priority: body.priority as never,
        sortRank: body.sortRank == null ? undefined : Number(body.sortRank),
        provenance: String(body.provenance ?? 'MANUAL'),
        rationale: String(body.rationale ?? 'OWNER created'),
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-coverage/slots/:id')
  async getCoverageSlot(@Param('id') id: string) {
    const row = await this.coverage.getSlot(id);
    if (!row) throw new NotFoundException('COVERAGE_SLOT_NOT_FOUND');
    return row;
  }

  @Patch('admin/recipe-coverage/slots/:id')
  async patchCoverageSlot(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      if (body.publishedRecipeCount != null || body.slotKey != null || body.matrixVersion != null) {
        throw new Error('COVERAGE_IMMUTABLE_FIELDS');
      }
      return await this.coverage.patchSlot({
        slotId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        name: body.name == null ? undefined : String(body.name),
        description: body.description == null ? undefined : String(body.description),
        desiredRecipeCount: body.desiredRecipeCount == null ? undefined : Number(body.desiredRecipeCount),
        priority: body.priority as never,
        active: body.active == null ? undefined : Boolean(body.active),
        rationale: body.rationale == null ? undefined : String(body.rationale),
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Delete('admin/recipe-coverage/slots/:id')
  @RequireRecentOwnerReauth()
  async deleteCoverageTestSlot(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    try {
      const actor = this.actor(user);
      return await this.coverage.softDeleteTestSlot({
        slotId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason: String(body?.reason ?? 'e2e cleanup'),
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-coverage/slots/:id/assignments')
  async listCoverageAssignments(@Param('id') id: string) {
    return { items: await this.coverage.listAssignments(id) };
  }

  @Post('admin/recipe-coverage/slots/:id/assignments')
  async assignCoverage(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { recipeVersionId?: string; assignmentType?: string; reason?: string },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.recipeVersionId || !body?.assignmentType || !body?.reason) {
        throw new Error('COVERAGE_ASSIGNMENT_INVALID');
      }
      return await this.coverage.manualAssign({
        slotId: id,
        recipeVersionId: body.recipeVersionId,
        assignmentType: body.assignmentType as never,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason: body.reason,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-coverage/matrix')
  async getCoverageMatrix() {
    return {
      matrixVersion: this.coverage.matrixVersion,
      ...(await this.coverage.listSlots({ limit: 200 })),
    };
  }

  @Get('admin/recipe-coverage/matrix/report')
  async getCoverageMatrixReport() {
    return this.coverage.matrixReport();
  }

  @Post('admin/recipe-coverage/matrix/seed')
  @RequireRecentOwnerReauth()
  async seedCoverageMatrix(@CurrentUser() user: RequestUser) {
    try {
      const actor = this.actor(user);
      const seed = await this.coverage.seedMatrixV1(actor.id);
      const analysis = await this.coverage.runInitialSnapshotAnalysis(actor.id);
      return { seed, analysis };
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-coverage/analyze')
  @RequireRecentOwnerReauth()
  async analyzeCoverage(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      matrixVersion?: string;
      mode?: string;
      slotIds?: string[];
      recipeVersionIds?: string[];
      reason?: string;
      dryRun?: boolean;
      publishedRecipeCount?: unknown;
      status?: unknown;
      assignments?: unknown;
      inputChecksum?: unknown;
      resultChecksum?: unknown;
      requestedBy?: unknown;
    },
  ) {
    try {
      const actor = this.actor(user);
      if (
        body.publishedRecipeCount != null ||
        body.status != null ||
        body.assignments != null ||
        body.inputChecksum != null ||
        body.resultChecksum != null ||
        body.requestedBy != null
      ) {
        throw new Error('COVERAGE_MASS_ASSIGNMENT_FORBIDDEN');
      }
      if (!body?.reason?.trim()) throw new Error('COVERAGE_ANALYZE_REASON_REQUIRED');
      const mode = String(body.mode ?? 'FULL');
      if (mode === 'FULL' && !body.dryRun && String(actor.role).toUpperCase() !== 'OWNER') {
        throw new Error('OWNER_ACCESS_FORBIDDEN');
      }
      return await this.coverageAnalyzer.analyze({
        matrixVersion: body.matrixVersion,
        mode: mode as 'FULL' | 'INCREMENTAL_SLOTS' | 'INCREMENTAL_RECIPES',
        slotIds: body.slotIds,
        recipeVersionIds: body.recipeVersionIds,
        reason: body.reason,
        dryRun: Boolean(body.dryRun),
        triggerType: 'MANUAL',
        requestedBy: actor.id,
        actorRole: actor.role,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-coverage/runs')
  async listCoverageRuns(
    @Query('matrixVersion') matrixVersion?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      items: await this.coverageAnalyzer.listRuns(matrixVersion, limit ? Number(limit) : 20),
    };
  }

  @Get('admin/recipe-coverage/runs/:runId')
  async getCoverageRun(@Param('runId') runId: string) {
    const row = await this.coverageAnalyzer.getRun(runId);
    if (!row) throw new NotFoundException('COVERAGE_RUN_NOT_FOUND');
    return row;
  }

  @Get('admin/recipe-coverage/dirty')
  async getCoverageDirty(@Query('matrixVersion') matrixVersion?: string) {
    return { dirty: await this.coverageAnalyzer.getDirty(matrixVersion) };
  }

  @Post('admin/recipe-coverage/dirty/retry')
  async retryCoverageDirty(@CurrentUser() user: RequestUser, @Body() body: { reason?: string }) {
    try {
      const actor = this.actor(user);
      await this.coverageAnalyzer.markDirty({
        reasons: ['MANUAL'],
        debounceMs: 0,
      });
      await this.auditRetry(actor.id, body?.reason);
      return await this.coverageAnalyzer.processDirtyQueue();
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-search/preflight')
  async recipeSearchPreflight(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      coverageSlotId?: string;
      requestType?: string;
      reason?: string;
      overrides?: Record<string, unknown>;
      recommendation?: unknown;
      score?: unknown;
      inputChecksum?: unknown;
      resultChecksum?: unknown;
      eligibility?: unknown;
    },
  ) {
    try {
      const actor = this.actor(user);
      assertNoClientControlledSearchFields(body as Record<string, unknown>);
      if (!body?.reason?.trim()) throw new Error('SEARCH_REASON_REQUIRED');
      return await this.recipeSearch.preflight({
        coverageSlotId: body.coverageSlotId ?? null,
        requestType: body.requestType as
          | 'COVERAGE_SLOT_REVIEW'
          | 'NEW_RECIPE_PREFLIGHT'
          | 'VARIANT_PREFLIGHT'
          | 'RESEARCH_PREFLIGHT'
          | 'MANUAL_OWNER_SEARCH'
          | undefined,
        reason: body.reason,
        requestedBy: actor.id,
        overrides: (body.overrides as never) ?? null,
        rawBody: body as Record<string, unknown>,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-search/runs')
  async listRecipeSearchRuns(
    @Query('coverageSlotId') coverageSlotId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.recipeSearch.listRuns({
      coverageSlotId,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('admin/recipe-search/runs/:runId')
  async getRecipeSearchRun(@Param('runId') runId: string) {
    try {
      return await this.recipeSearch.getRun(runId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-search/runs/:runId/candidates')
  async getRecipeSearchCandidates(@Param('runId') runId: string) {
    try {
      return await this.recipeSearch.getCandidates(runId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-search/runs/:runId/issue-decision')
  async issueRecipeSearchDecision(
    @CurrentUser() user: RequestUser,
    @Param('runId') runId: string,
    @Body() body: { oneTime?: boolean },
  ) {
    try {
      const actor = this.actor(user);
      return await this.recipeSearch.issueDecision({
        runId,
        actorUserId: actor.id,
        actorRole: actor.role,
        oneTime: body?.oneTime,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-search/runs/:runId/invalidate')
  async invalidateRecipeSearchDecision(
    @CurrentUser() user: RequestUser,
    @Param('runId') runId: string,
    @Body() body: { reason?: string; decisionId?: string },
  ) {
    try {
      const actor = this.actor(user);
      return await this.recipeSearch.invalidateDecision({
        runId,
        actorUserId: actor.id,
        reason: body?.reason ?? '',
        decisionId: body?.decisionId,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-coverage/slots/:id/search')
  async searchCoverageSlot(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body()
    body: {
      reason?: string;
      requestType?: string;
      overrides?: Record<string, unknown>;
      recommendation?: unknown;
      score?: unknown;
    },
  ) {
    try {
      const actor = this.actor(user);
      assertNoClientControlledSearchFields(body as Record<string, unknown>);
      if (!body?.reason?.trim()) throw new Error('SEARCH_REASON_REQUIRED');
      return await this.recipeSearch.preflight({
        coverageSlotId: id,
        requestType: (body.requestType as 'COVERAGE_SLOT_REVIEW') ?? 'COVERAGE_SLOT_REVIEW',
        reason: body.reason,
        requestedBy: actor.id,
        overrides: (body.overrides as never) ?? null,
        rawBody: body as Record<string, unknown>,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  private async auditRetry(actorUserId: string, reason?: string) {
    // Lightweight audit via analyzer's dependency is elsewhere; controller uses coverage service audit path.
    void actorUserId;
    void reason;
  }
}
