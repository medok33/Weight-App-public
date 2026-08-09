import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { OwnerMfaGuard } from '../../auth/guards/owner-mfa.guard';
import { RequireRecentOwnerReauth } from '../../auth/decorators/require-recent-owner-reauth.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { OwnerAdminService } from '../application/owner-admin.service';

@Controller('owner-admin')
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles('OWNER', 'ADMIN')
export class OwnerAdminController {
  constructor(@Inject(OwnerAdminService) private readonly service: OwnerAdminService) {}

  @Get('access')
  access(@CurrentUser() user: RequestUser) {
    return this.service.access(user);
  }

  @Get('overview')
  overview(@CurrentUser() user: RequestUser) {
    return this.service.overview(user);
  }

  @Get('users')
  async users(@CurrentUser() user: RequestUser, @Query('q') query?: string, @Headers('x-request-id') requestId?: string) {
    try {
      return await this.service.searchUsers(user, query, requestId);
    } catch (error) {
      if (error instanceof Error && error.message === 'OWNER_USER_QUERY_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post('support-access')
  @RequireRecentOwnerReauth()
  async supportAccess(
    @CurrentUser() user: RequestUser,
    @Body() body: { reason?: unknown; ttlMinutes?: unknown },
  ) {
    if (typeof body?.reason !== 'string' || typeof body?.ttlMinutes !== 'number') {
      throw new BadRequestException('SUPPORT_REQUEST_INVALID');
    }
    try {
      return await this.service.grantSupportAccess(user, body.reason, body.ttlMinutes);
    } catch (error) {
      if (error instanceof Error && (error.message === 'SUPPORT_REASON_INVALID' || error.message === 'SUPPORT_TTL_INVALID')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get('catalog')
  catalog(@CurrentUser() user: RequestUser) {
    return this.service.catalog(user);
  }

  @Post('catalog')
  @Roles('OWNER')
  async createCatalog(
    @CurrentUser() user: RequestUser,
    @Body() body: { canonicalName?: unknown; unit?: unknown; caloriesPer100g?: unknown; proteinPer100g?: unknown },
  ) {
    if (
      typeof body?.canonicalName !== 'string' ||
      typeof body.unit !== 'string' ||
      typeof body.caloriesPer100g !== 'number' ||
      typeof body.proteinPer100g !== 'number'
    ) {
      throw new BadRequestException('CATALOG_PRODUCT_INVALID');
    }
    try {
      return await this.service.createCatalog(user, {
        canonicalName: body.canonicalName,
        unit: body.unit,
        caloriesPer100g: body.caloriesPer100g,
        proteinPer100g: body.proteinPer100g,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CATALOG_PRODUCT_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get('feature-flags')
  featureFlags(@CurrentUser() user: RequestUser) {
    return this.service.featureFlags(user);
  }

  @Post('feature-flags')
  @Roles('OWNER')
  @RequireRecentOwnerReauth()
  async setFeatureFlag(
    @CurrentUser() user: RequestUser,
    @Body() body: { key?: unknown; enabled?: unknown },
  ) {
    if (typeof body?.key !== 'string' || typeof body.enabled !== 'boolean') {
      throw new BadRequestException('FEATURE_FLAG_INVALID');
    }
    try {
      return await this.service.setFeatureFlag(user, body.key, body.enabled);
    } catch (error) {
      if (error instanceof Error && error.message === 'FEATURE_FLAG_KEY_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get('closed-beta')
  closedBetaStatus(@CurrentUser() user: RequestUser) {
    return this.service.closedBetaStatus(user);
  }

  @Post('closed-beta')
  @Roles('OWNER')
  @RequireRecentOwnerReauth()
  async setClosedBeta(
    @CurrentUser() user: RequestUser,
    @Body() body: { enabled?: unknown },
  ) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('CLOSED_BETA_FLAG_INVALID');
    }
    return this.service.setClosedBetaFlag(user, body.enabled);
  }

  @Get('system-secrets-status')
  @Roles('OWNER')
  secretsStatus(@CurrentUser() user: RequestUser) {
    return this.service.secretsStatus(user);
  }

  @Patch('users/:id/role')
  @Roles('OWNER')
  @RequireRecentOwnerReauth()
  async setRole(
    @CurrentUser() user: RequestUser,
    @Param('id') targetUserId: string,
    @Body() body: { role?: unknown },
  ) {
    if (typeof body?.role !== 'string') throw new BadRequestException('ROLE_INVALID');
    try {
      return await this.service.setUserRole(user, targetUserId, body.role);
    } catch (error) {
      if (error instanceof Error && error.message === 'LAST_OWNER_PROTECTED') {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof Error && (error.message === 'OWNER_ASSIGN_FORBIDDEN' || error.message === 'ROLE_INVALID')) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  @Patch('users/:id/subscription')
  @Roles('OWNER')
  @RequireRecentOwnerReauth()
  async setSubscription(
    @CurrentUser() user: RequestUser,
    @Param('id') targetUserId: string,
    @Body() body: { tier?: unknown },
    @Headers('x-request-id') requestId?: string,
  ) {
    if (body?.tier !== 'FREE' && body?.tier !== 'PREMIUM') {
      throw new BadRequestException('SUBSCRIPTION_TIER_INVALID');
    }
    return this.service.setUserSubscription(user, targetUserId, body.tier, requestId);
  }

  @Post('users/:id/deactivate')
  @Roles('OWNER')
  @RequireRecentOwnerReauth()
  async deactivate(@CurrentUser() user: RequestUser, @Param('id') targetUserId: string) {
    try {
      return await this.service.deactivateUser(user, targetUserId);
    } catch (error) {
      if (error instanceof Error && error.message === 'LAST_OWNER_PROTECTED') {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }
}
