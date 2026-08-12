import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { resolveSessionTokenFromHeaders } from '../auth/domain/session-cookie';
import { PriceAdminService } from './application/price-admin.service';
import { PriceIntelligenceService } from './application/price-intelligence.service';
import type { OpenDataFormat } from './application/price-ingestion.service';
import type { CreateProductInput, UpdateProductInput, UpdateRetailerInput } from './domain/price-admin.types';
import type { ManualPriceRow, PriceSourceType } from './domain/price-intelligence.types';

@Public()
@Controller('price-intelligence')
export class PriceIntelligenceController {
  constructor(
    @Inject(PriceIntelligenceService) private readonly service: PriceIntelligenceService,
    @Inject(PriceAdminService) private readonly admin: PriceAdminService,
  ) {}

  private token(token?: string, cookie?: string) {
    return resolveSessionTokenFromHeaders({ token, cookie });
  }

  private allowOpenIngest() {
    return process.env.ALLOW_OPEN_PRICE_INGEST === '1' || process.env.NODE_ENV !== 'production';
  }

  @Get('review')
  async review(@Headers('x-session-token') token?: string, @Headers('cookie') cookie?: string) {
    try {
      return await this.service.reviewForSession(this.token(token, cookie));
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('evidence/:productId')
  async readReferencePrice(@Param('productId') productId: string, @Query('storeId') storeId?: string, @Query('regionId') regionId?: string) {
    if (!productId?.trim()) throw new BadRequestException('PRODUCT_INVALID');
    return this.service.readReferencePrice(productId, { storeId, regionId });
  }

  @Post('import')
  async import(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { csv?: unknown },
  ) {
    if (typeof body?.csv !== 'string' || body.csv.length > 1_000_000) throw new BadRequestException('PRICE_IMPORT_INVALID');
    try {
      return await this.service.importForSession(this.token(token, cookie), body.csv);
    } catch {
      throw new BadRequestException('PRICE_IMPORT_INVALID');
    }
  }

  @Post('sources/open-data')
  async ingestOpenData(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { format?: unknown; payload?: unknown; sourceName?: unknown },
  ) {
    const format = String(body?.format ?? 'csv') as OpenDataFormat;
    const payload = body?.payload;
    if (typeof payload !== 'string' || payload.length > 2_000_000) throw new BadRequestException('PRICE_IMPORT_INVALID');
    const sourceName = typeof body?.sourceName === 'string' ? body.sourceName : undefined;
    try {
      return await this.service.ingestOpenDataForSession(this.token(token, cookie), format, payload, sourceName);
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        try {
          return await this.service.ingestOpenDataLocal(format, payload, sourceName);
        } catch (localError) {
          throw new BadRequestException(localError instanceof Error ? localError.message : 'PRICE_IMPORT_INVALID');
        }
      }
      if (error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'PRICE_IMPORT_INVALID');
    }
  }

  @Post('sources/manual')
  async ingestManual(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { rows?: unknown; csv?: unknown; sourceName?: unknown },
  ) {
    const sourceName = typeof body?.sourceName === 'string' ? body.sourceName : undefined;
    try {
      if (typeof body?.csv === 'string') {
        return await this.service.ingestManualCsvForSession(this.token(token, cookie), body.csv, sourceName);
      }
      if (!Array.isArray(body?.rows)) throw new BadRequestException('PRICE_IMPORT_INVALID');
      return await this.service.ingestManualForSession(this.token(token, cookie), body.rows as ManualPriceRow[], sourceName);
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        try {
          if (typeof body?.csv === 'string') {
            return await this.service.ingestManualCsvLocal(body.csv, sourceName);
          }
          return await this.service.ingestManualLocal(body.rows as ManualPriceRow[], sourceName);
        } catch (localError) {
          throw new BadRequestException(localError instanceof Error ? localError.message : 'PRICE_IMPORT_INVALID');
        }
      }
      if (error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'PRICE_IMPORT_INVALID');
    }
  }

  @Post('sources/mock-api')
  async syncMockApi(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { sourceName?: unknown },
  ) {
    const sourceName = typeof body?.sourceName === 'string' ? body.sourceName : undefined;
    try {
      return await this.service.syncMockApiForSession(this.token(token, cookie), sourceName);
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        return await this.service.syncMockApiLocal(sourceName);
      }
      if (error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'PRICE_SYNC_FAILED');
    }
  }

  /** Primary CSV catalog import: product_key,name,category,weight,price,retailer */
  @Post('sources/catalog-csv')
  async syncCatalogCsv(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { payload?: unknown; sourceName?: unknown; retailerCode?: unknown },
  ) {
    const payload = body?.payload;
    if (typeof payload !== 'string' || payload.length > 2_000_000) throw new BadRequestException('PRICE_IMPORT_INVALID');
    const sourceName = typeof body?.sourceName === 'string' ? body.sourceName : undefined;
    const retailerCode = typeof body?.retailerCode === 'string' ? body.retailerCode : undefined;
    try {
      return await this.service.syncCatalogCsvForSession(this.token(token, cookie), payload, sourceName, retailerCode);
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        try {
          return await this.service.syncCatalogCsvLocal(payload, sourceName, retailerCode);
        } catch (localError) {
          throw new BadRequestException(localError instanceof Error ? localError.message : 'PRICE_IMPORT_INVALID');
        }
      }
      if (error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'PRICE_IMPORT_INVALID');
    }
  }

  @Post('sources/catalog-csv/validate')
  async validateCatalogCsv(@Body() body: { payload?: unknown }) {
    const payload = body?.payload;
    if (typeof payload !== 'string' || payload.length > 2_000_000) throw new BadRequestException('PRICE_IMPORT_INVALID');
    return this.admin.validateCatalogCsv(payload);
  }

  @Get('admin/meta')
  async adminMeta(@Headers('x-session-token') token?: string, @Headers('cookie') cookie?: string) {
    try {
      return await this.admin.metaForSession(this.token(token, cookie));
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        return this.admin.metaLocal();
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('admin/retailers')
  async listRetailers(@Headers('x-session-token') token?: string, @Headers('cookie') cookie?: string) {
    try {
      return await this.admin.listRetailersForSession(this.token(token, cookie));
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        return this.admin.listRetailersLocal();
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Patch('admin/retailers/:id')
  async updateRetailer(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Body() body: UpdateRetailerInput,
  ) {
    try {
      return await this.admin.updateRetailerForSession(this.token(token, cookie), id, body);
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        return this.admin.updateRetailerLocal(id, body);
      }
      if (error instanceof Error && error.message === 'RETAILER_NOT_FOUND') throw new BadRequestException(error.message);
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('admin/products')
  async listProducts(@Headers('x-session-token') token?: string, @Headers('cookie') cookie?: string) {
    try {
      return await this.admin.listProductsForSession(this.token(token, cookie));
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        return this.admin.listProductsLocal();
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('admin/products')
  async createProduct(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: CreateProductInput,
  ) {
    try {
      return await this.admin.createProductForSession(this.token(token, cookie), body);
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        return this.admin.createProductLocal(body);
      }
      if (error instanceof Error && error.message === 'PRODUCT_INVALID') throw new BadRequestException(error.message);
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Patch('admin/products/:id')
  async updateProduct(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Body() body: UpdateProductInput,
  ) {
    try {
      return await this.admin.updateProductForSession(this.token(token, cookie), id, body);
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        return this.admin.updateProductLocal(id, body);
      }
      if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') throw new BadRequestException(error.message);
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('admin/observations')
  async listObservations(
    @Headers('x-session-token') token?: string,
    @Headers('cookie') cookie?: string,
    @Query('productId') productId?: string,
    @Query('retailerId') retailerId?: string,
    @Query('sourceType') sourceType?: string,
    @Query('limit') limit?: string,
  ) {
    const filters = {
      productId: productId || undefined,
      retailerId: retailerId || undefined,
      sourceType: sourceType as PriceSourceType | undefined,
      limit: limit ? Number(limit) : undefined,
    };
    try {
      return await this.admin.listObservationsForSession(this.token(token, cookie), filters);
    } catch (error) {
      if (this.allowOpenIngest() && error instanceof Error && error.message === 'OWNER_ACCESS_FORBIDDEN') {
        return this.admin.listObservationsLocal(filters);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }
}
