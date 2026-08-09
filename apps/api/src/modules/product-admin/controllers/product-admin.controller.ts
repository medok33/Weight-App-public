import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { OwnerMfaGuard } from '../../auth/guards/owner-mfa.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { RequireRecentOwnerReauth } from '../../auth/decorators/require-recent-owner-reauth.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { ProductAdminService } from '../application/product-admin.service';
import type { ProductListFilters } from '../domain/product-admin.types';

@Controller('admin')
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles('OWNER', 'ADMIN')
export class ProductAdminController {
  constructor(@Inject(ProductAdminService) private readonly service: ProductAdminService) {}

  private mapError(error: unknown): never {
    if (!(error instanceof Error)) throw error;
    const message = error.message;
    if (message === 'OWNER_ACCESS_FORBIDDEN') throw new UnauthorizedException(message);
    if (message === 'OWNER_ROLE_REQUIRED' || message === 'MFA_REQUIRED') throw new ForbiddenException(message);
    if (message === 'PRODUCT_VERSION_CONFLICT' || message === 'PRODUCT_SUBSTITUTION_DUPLICATE') {
      throw new ConflictException(message);
    }
    if (message === 'PRODUCT_POSSIBLE_DUPLICATE') {
      throw new BadRequestException({
        code: message,
        similar: (error as Error & { similar?: unknown }).similar ?? [],
      });
    }
    if (
      message.startsWith('PRODUCT_') ||
      message.startsWith('MERGE_') ||
      message.startsWith('RETAIL_') ||
      message.startsWith('SOURCE_') ||
      message.startsWith('TARGET_') ||
      message === 'PRODUCT_ADMIN_RATE_LIMITED'
    ) {
      throw new BadRequestException(message);
    }
    throw error;
  }

  @Get('products')
  async list(
    @CurrentUser() user: RequestUser,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('form') form?: string,
    @Query('nutrition') nutrition?: string,
    @Query('reviewStatus') reviewStatus?: string,
    @Query('status') status?: string,
    @Query('unclassified') unclassified?: string,
    @Query('roleMissing') roleMissing?: string,
    @Query('retailMissing') retailMissing?: string,
    @Query('legacyPriceOnly') legacyPriceOnly?: string,
    @Query('allergenReview') allergenReview?: string,
    @Query('dietaryReview') dietaryReview?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    try {
      const filters: ProductListFilters = {
        q,
        categoryId,
        form,
        nutrition: nutrition as ProductListFilters['nutrition'],
        reviewStatus: reviewStatus as ProductListFilters['reviewStatus'],
        status: status as ProductListFilters['status'],
        unclassified: unclassified === '1' || unclassified === 'true',
        roleMissing: roleMissing === '1' || roleMissing === 'true',
        retailMissing: retailMissing === '1' || retailMissing === 'true',
        legacyPriceOnly: legacyPriceOnly === '1' || legacyPriceOnly === 'true',
        allergenReview: allergenReview === '1' || allergenReview === 'true',
        dietaryReview: dietaryReview === '1' || dietaryReview === 'true',
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 25,
        sort: (sort as ProductListFilters['sort']) ?? 'updatedAt',
        order: order === 'asc' ? 'asc' : 'desc',
      };
      return await this.service.list(user, filters);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('products/meta')
  async meta(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.metaLookups(user);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('products')
  async create(
    @CurrentUser() user: RequestUser,
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.create(user, body as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('products/:id')
  async detail(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.detail(user, id);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch('products/:id')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.update(user, id, body as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('products/:id/aliases')
  async addAlias(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.addAlias(user, id, body as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch('product-aliases/:aliasId')
  async patchAlias(
    @CurrentUser() user: RequestUser,
    @Param('aliasId') aliasId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.patchAlias(user, aliasId, body as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Delete('product-aliases/:aliasId')
  @RequireRecentOwnerReauth()
  async deleteAlias(
    @CurrentUser() user: RequestUser,
    @Param('aliasId') aliasId: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.deleteAlias(user, aliasId, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('products/:id/nutrition-versions')
  async nutrition(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.createNutritionVersion(user, id, body as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Put('products/:id/allergens')
  async allergens(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { items?: unknown },
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      if (!Array.isArray(body?.items)) throw new BadRequestException('PRODUCT_ALLERGENS_INVALID');
      return await this.service.putAllergens(user, id, body.items as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Put('products/:id/dietary-tags')
  async dietary(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { items?: unknown },
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      if (!Array.isArray(body?.items)) throw new BadRequestException('PRODUCT_DIETARY_INVALID');
      return await this.service.putDietaryTags(user, id, body.items as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Put('products/:id/culinary-roles')
  async roles(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { items?: unknown },
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      if (!Array.isArray(body?.items)) throw new BadRequestException('PRODUCT_ROLES_INVALID');
      return await this.service.putCulinaryRoles(user, id, body.items as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('products/:id/substitutions')
  async createSub(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.createSubstitution(user, id, body as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch('product-substitutions/:id')
  async patchSub(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.patchSubstitution(user, id, body as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('product-substitutions/:id/suspend')
  @RequireRecentOwnerReauth()
  async suspendSub(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.setSubstitutionStatus(user, id, 'SUSPENDED', requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('product-substitutions/:id/activate')
  async activateSub(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.setSubstitutionStatus(user, id, 'ACTIVE', requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('products/:id/retail-products')
  async retail(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.listRetail(user, id);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('products/:id/prices')
  async prices(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.listPrices(user, id);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('products/:id/retail-products/:retailProductId/remap')
  async remap(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('retailProductId') retailProductId: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.remapRetailProduct(user, id, retailProductId, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('products/:id/review')
  async review(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      return await this.service.review(user, id, body as never, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('products/:id/merge-preview')
  async mergePreview(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { targetProductId?: string },
  ) {
    try {
      if (!body?.targetProductId) throw new BadRequestException('MERGE_TARGET_REQUIRED');
      return await this.service.mergePreview(user, id, body.targetProductId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post('products/:id/merge')
  @Roles('OWNER')
  @RequireRecentOwnerReauth()
  async merge(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { targetProductId?: string },
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      if (!body?.targetProductId) throw new BadRequestException('MERGE_TARGET_REQUIRED');
      return await this.service.merge(user, id, body.targetProductId, requestId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('product-review')
  async productReview(
    @CurrentUser() user: RequestUser,
    @Query('queue') queue?: string,
    @Query('datasetVersion') datasetVersion?: string,
    @Query('severity') severity?: string,
    @Query('source') source?: string,
    @Query('category') category?: string,
    @Query('issueType') issueType?: string,
  ) {
    try {
      return await this.service.reviewQueue(user, {
        queue,
        datasetVersion,
        severity,
        source,
        category,
        issueType,
      });
    } catch (error) {
      this.mapError(error);
    }
  }

  @Get('product-duplicates')
  async productDuplicates(@CurrentUser() user: RequestUser, @Query('limit') limit?: string) {
    try {
      return await this.service.duplicates(user, limit ? Number(limit) : 50);
    } catch (error) {
      this.mapError(error);
    }
  }
}
