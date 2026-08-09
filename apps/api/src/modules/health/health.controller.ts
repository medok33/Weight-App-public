import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { HealthService, type ReadinessResult } from './health.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(@Res() res: Response) {
    try {
      const result = await Promise.race([
        this.health.readiness(),
        new Promise<ReadinessResult & { timedOut: true }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                ready: false,
                status: 'not_ready',
                checks: { postgres: false, redis: false, api: true },
                timedOut: true,
              }),
            5000,
          ),
        ),
      ]);
      if (!result.ready) {
        return res.status(HttpStatus.SERVICE_UNAVAILABLE).json(result);
      }
      return res.status(HttpStatus.OK).json(result);
    } catch {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        ready: false,
        status: 'not_ready',
        checks: { postgres: false, redis: false, api: true },
      });
    }
  }
}
