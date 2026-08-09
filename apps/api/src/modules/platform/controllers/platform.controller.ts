import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { OwnerMfaGuard } from '../../auth/guards/owner-mfa.guard';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { PlatformService } from '../application/platform.service';

@Controller('platform')
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles('OWNER', 'ADMIN')
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly service: PlatformService) {}

  @Post('beta-blockers/triage')
  triage(@CurrentUser() user: RequestUser, @Body() body: { items?: unknown }) {
    if (!Array.isArray(body?.items)) throw new BadRequestException('BETA_TRIAGE_EMPTY');
    try {
      return this.service.triage(user.role, body.items as never);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'BETA_TRIAGE_EMPTY' || error.message === 'BETA_BLOCKER_INVALID')
      ) {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('release-candidate')
  currentRc(@CurrentUser() user: RequestUser) {
    try {
      return { record: this.service.currentRc(user.role) };
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('release-candidate/freeze')
  freezeRc(
    @CurrentUser() user: RequestUser,
    @Body() body: { version?: unknown; changelog?: unknown; commitSha?: unknown },
  ) {
    if (
      typeof body?.version !== 'string' ||
      typeof body?.changelog !== 'string' ||
      typeof body?.commitSha !== 'string'
    ) {
      throw new BadRequestException('RC_INVALID');
    }
    try {
      return this.service.freezeRc(user.role, {
        version: body.version,
        changelog: body.changelog,
        commitSha: body.commitSha,
        frozenBy: user.id,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'RC_VERSION_INVALID' ||
          error.message === 'RC_CHANGELOG_INVALID' ||
          error.message === 'RC_COMMIT_INVALID' ||
          error.message === 'RC_ACTOR_INVALID')
      ) {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }
}
