import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { ExportShareService } from '../application/export-share.service';
import { validateShareChannel } from '../domain/share.policy';
import type { ExportJobType } from '../domain/export-share.types';

@Controller('export-share')
export class ExportShareController {
  constructor(@Inject(ExportShareService) private readonly service: ExportShareService) {}

  @Get('catalog')
  catalog() {
    return this.service.listDocumentCatalog();
  }

  @Get('jobs')
  async listJobs(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.listJobs(user.id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('jobs')
  async createJob(
    @CurrentUser() user: RequestUser,
    @Body() body: { type?: unknown; idempotencyKey?: unknown },
  ) {
    if (body?.type !== 'meal_plan_pdf' && body?.type !== 'shopping_list_print') {
      throw new BadRequestException('EXPORT_JOB_INVALID');
    }
    if (typeof body.idempotencyKey !== 'string') throw new BadRequestException('EXPORT_JOB_INVALID');
    try {
      return await this.service.createExport(user.id, body.type as ExportJobType, body.idempotencyKey);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Get('jobs/:id')
  async getJob(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.getJob(user.id, id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('jobs/:id/download-link')
  async downloadLink(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.signedDownloadForJob(user.id, id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Public()
  @Get('download')
  async download(
    @Query('key') key: string | undefined,
    @Query('expires') expires: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    try {
      if (!key || !expires || !sig) throw new Error('EXPORT_DOWNLOAD_FORBIDDEN');
      const file = await this.service.downloadBySignature(key, Number(expires), sig);
      res.setHeader('content-type', file.contentType);
      res.setHeader('cache-control', 'private, no-store');
      res.send(file.body);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Get('shopping-print')
  async shoppingPrint(@CurrentUser() user: RequestUser, @Res() res: Response) {
    try {
      const html = await this.service.shoppingPrintHtmlPreview(user.id);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('jobs/:id/share-links')
  async createShare(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { ttlMinutes?: unknown },
  ) {
    const ttl = typeof body?.ttlMinutes === 'number' ? body.ttlMinutes : 60 * 24;
    try {
      return await this.service.createShareLink(user.id, id, ttl);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Delete('share-links/:id')
  async revokeShare(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.revokeShareLink(user.id, id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Get('jobs/:id/share-adapters')
  async shareAdapters(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Headers('x-public-base-url') baseUrl: string | undefined,
  ) {
    try {
      const publicBase = baseUrl?.trim() || process.env.PUBLIC_WEB_BASE_URL || 'http://localhost:3000';
      return await this.service.resolveShareAdapters(user.id, id, publicBase);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Public()
  @Get('share/:token')
  async openShare(@Param('token') token: string) {
    try {
      return await this.service.publicSharePreview(token);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Get('channels/:channel/validate')
  validateChannel(@Param('channel') channel: string) {
    try {
      return { channel: validateShareChannel(channel) };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown) {
    const code = error instanceof Error ? error.message : 'EXPORT_FAILED';
    if (code === 'EXPORT_JOB_NOT_FOUND' || code === 'SHARE_LINK_NOT_FOUND' || code === 'EXPORT_STORAGE_MISSING') {
      return new NotFoundException(code);
    }
    if (code === 'EXPORT_FORBIDDEN' || code === 'EXPORT_DOWNLOAD_FORBIDDEN') return new ForbiddenException(code);
    if (code === 'EXPORT_DOWNLOAD_EXPIRED' || code === 'SHARE_LINK_EXPIRED' || code === 'SHARE_LINK_REVOKED') {
      return new UnauthorizedException(code);
    }
    if (
      code === 'EXPORT_JOB_INVALID' ||
      code === 'EXPORT_NOT_READY' ||
      code === 'SHARE_TTL_INVALID' ||
      code === 'SHARE_CHANNEL_INVALID' ||
      code === 'SHARE_URL_INVALID' ||
      code === 'EXPORT_SIGNED_TTL_INVALID' ||
      code === 'EXPORT_STORAGE_KEY_INVALID'
    ) {
      return new BadRequestException(code);
    }
    return new BadRequestException(code);
  }
}
