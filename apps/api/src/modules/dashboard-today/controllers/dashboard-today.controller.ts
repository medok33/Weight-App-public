import { Controller, Get, Inject } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { DashboardTodayService } from '../application/dashboard-today.service';

@Controller('dashboard/today')
export class DashboardTodayController {
  constructor(@Inject(DashboardTodayService) private readonly service: DashboardTodayService) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.service.get(user.id);
  }
}
