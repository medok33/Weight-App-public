import {
  Body,
  Controller,
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
import { RecipeExternalSourceService } from '../application/recipe-external-source.service';
import { RecipeSourceAdapterError } from '../domain/recipe-source-adapter.contract';
import { RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT } from '../domain/recipe-source-network.policy';
import { RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION } from '../domain/recipe-external-source.policy';

@Controller()
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles('OWNER', 'ADMIN')
export class RecipeSourceAdminController {
  constructor(
    @Inject(RecipeExternalSourceService) private readonly sources: RecipeExternalSourceService,
  ) {}

  private actor(user: RequestUser) {
    const id = user.id;
    if (!id) throw new UnauthorizedException('AUTH_REQUIRED');
    return { id, role: String(user.role ?? '') };
  }

  private mapError(error: unknown): never {
    if (error instanceof RecipeSourceAdapterError) {
      throw new ForbiddenException(error.toPublic());
    }
    const message = error instanceof Error ? error.message : 'RECIPE_SOURCE_ERROR';
    if (message === 'OWNER_ACCESS_FORBIDDEN') throw new UnauthorizedException(message);
    if (message === 'RECIPE_SOURCE_NOT_FOUND') throw new NotFoundException(message);
    if (message.startsWith('RECIPE_SOURCE_') || message.startsWith('SOURCE_')) {
      throw new ForbiddenException({ code: message, message });
    }
    throw new ForbiddenException(message);
  }

  @Get('admin/recipe-sources')
  async list(
    @Query('rightsStatus') rightsStatus?: string,
    @Query('enabled') enabled?: string,
    @Query('dataClass') dataClass?: string,
  ) {
    try {
      return await this.sources.listSources({
        rightsStatus,
        enabled: enabled === undefined ? undefined : enabled === 'true',
        dataClass,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-sources/meta')
  meta() {
    return {
      contractVersion: RECIPE_SOURCE_ADAPTER_CONTRACT_VERSION,
      networkSecurity: RECIPE_SOURCE_NETWORK_SECURITY_CONTRACT,
      adapterTypes: ['NOT_CONFIGURED', 'TEST_DETERMINISTIC', 'FOOD_RU', 'IAMCOOK', 'RUSSIANFOOD'],
    };
  }

  @Post('admin/recipe-sources')
  async create(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      code?: string;
      name?: string;
      baseUrl?: string;
      adapterType?: string;
      collectionMode?: string;
      dataClass?: string;
      parserVersion?: string;
      rateLimitPerMinute?: number;
      concurrencyLimit?: number;
      requestTimeoutMs?: number;
      rightsStatus?: unknown;
      enabled?: unknown;
      reviewedBy?: unknown;
      healthStatus?: unknown;
      adapterModule?: unknown;
    },
  ) {
    try {
      const actor = this.actor(user);
      if (!body?.code || !body?.name || !body?.baseUrl) {
        throw new Error('RECIPE_SOURCE_CREATE_INVALID');
      }
      return await this.sources.createSource({
        actorUserId: actor.id,
        actorRole: actor.role,
        code: body.code,
        name: body.name,
        baseUrl: body.baseUrl,
        adapterType: body.adapterType,
        collectionMode: body.collectionMode,
        dataClass: body.dataClass,
        parserVersion: body.parserVersion,
        rateLimitPerMinute: body.rateLimitPerMinute,
        concurrencyLimit: body.concurrencyLimit,
        requestTimeoutMs: body.requestTimeoutMs,
        rawBody: body as Record<string, unknown>,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-sources/:id')
  async get(@Param('id') id: string) {
    try {
      return await this.sources.getSource(id);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch('admin/recipe-sources/:id')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      return await this.sources.updateSource({
        id,
        actorUserId: actor.id,
        actorRole: actor.role,
        name: body.name as string | undefined,
        baseUrl: body.baseUrl as string | undefined,
        adapterType: body.adapterType as string | undefined,
        collectionMode: body.collectionMode as string | undefined,
        parserVersion: body.parserVersion as string | undefined,
        rateLimitPerMinute: body.rateLimitPerMinute as number | undefined,
        concurrencyLimit: body.concurrencyLimit as number | undefined,
        requestTimeoutMs: body.requestTimeoutMs as number | undefined,
        policyReason: body.policyReason as string | undefined,
        rawBody: body,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('admin/recipe-sources/:id/evidence')
  async evidence(@Param('id') id: string) {
    try {
      return await this.sources.listEvidence(id);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-sources/:id/evidence')
  async addEvidence(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      return await this.sources.addEvidence({
        sourceId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        evidenceType: String(body.evidenceType ?? ''),
        decision: String(body.decision ?? ''),
        referenceUrl: (body.referenceUrl as string) ?? null,
        documentReference: (body.documentReference as string) ?? null,
        notes: (body.notes as string) ?? null,
        validFrom: (body.validFrom as string) ?? null,
        validUntil: (body.validUntil as string) ?? null,
        checksum: (body.checksum as string) ?? null,
        rawBody: body,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-sources/:id/review')
  async review(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      return await this.sources.reviewSource({
        sourceId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        toStatus: String(body.toStatus ?? ''),
        reason: String(body.reason ?? ''),
        reviewExpiresAt: (body.reviewExpiresAt as string) ?? null,
        collectionMode: body.collectionMode as string | undefined,
        rawBody: body,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-sources/:id/enable')
  async enable(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      return await this.sources.enableSource({
        sourceId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason: String(body.reason ?? ''),
        rawBody: body,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-sources/:id/disable')
  @RequireRecentOwnerReauth()
  async disable(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const actor = this.actor(user);
      return await this.sources.disableSource({
        sourceId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason: String(body.reason ?? ''),
        rawBody: body,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-sources/:id/health-check')
  async healthCheck(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      const actor = this.actor(user);
      return await this.sources.configurationHealthCheck({
        sourceId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-sources/:id/fixture-search')
  async fixtureSearch(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { primaryProductIds?: string[]; resultLimit?: number; correlationId?: string },
  ) {
    try {
      const actor = this.actor(user);
      return await this.sources.runTestSearch({
        sourceId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        search: {
          primaryProductIds: body.primaryProductIds?.length ? body.primaryProductIds : ['synthetic'],
          locale: 'ru',
          resultLimit: Math.min(Math.max(Number(body.resultLimit) || 5, 1), 20),
          correlationId: body.correlationId?.trim() || `fixture-search:${Date.now()}`,
        },
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('admin/recipe-sources/:id/live-probe')
  async liveProbe(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { externalId?: string },
  ) {
    try {
      const actor = this.actor(user);
      return await this.sources.runLiveBlockedProbe({
        sourceId: id,
        actorUserId: actor.id,
        actorRole: actor.role,
        externalId: body?.externalId,
      });
    } catch (error) {
      this.mapError(error);
    }
  }
}
