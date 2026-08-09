import { Body, Controller, Get, Inject, NotFoundException, Post } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { ProgressService } from '../application/progress.service';

@Controller('progress')
export class ProgressController {
  constructor(@Inject(ProgressService) private readonly service: ProgressService) {}

  @Get()
  async list(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.summary(user.id);
    } catch {
      throw new NotFoundException('PROGRESS_NOT_FOUND');
    }
  }

  @Get('summary')
  async summary(@CurrentUser() user: RequestUser) {
    return this.list(user);
  }

  @Post()
  async create(@CurrentUser() user: RequestUser, @Body() body: { weightKg?: number; measuredAt?: string }) {
    if (body.weightKg == null) throw new NotFoundException('PROGRESS_ENTRY_INVALID');
    try {
      const saved = await this.service.save({
        userId: user.id,
        weightKg: Number(body.weightKg),
        measuredAt: body.measuredAt || new Date().toISOString(),
      });
      const summary = await this.service.summary(user.id);
      return { entry: saved, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PROGRESS_SAVE_FAILED';
      throw new NotFoundException(message);
    }
  }
}
