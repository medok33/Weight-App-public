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
import { ObservabilityService } from '../application/observability.service';

@Controller('observability')
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles('OWNER', 'ADMIN')
export class ObservabilityController {
  constructor(@Inject(ObservabilityService) private readonly service: ObservabilityService) {}

  @Get('operations')
  async operations(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.operationsForUser(user.id, user.role);
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('dashboard')
  async dashboard(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.dashboardForUser(user.id, user.role);
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('alerts')
  async alerts(@CurrentUser() user: RequestUser) {
    try {
      return { rules: await this.service.listAlertRules(user.role) };
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('alerts')
  async upsertAlert(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      id?: unknown;
      name?: unknown;
      metric?: unknown;
      threshold?: unknown;
      comparator?: unknown;
      enabled?: unknown;
    },
  ) {
    if (
      typeof body?.name !== 'string' ||
      typeof body?.metric !== 'string' ||
      typeof body?.threshold !== 'number' ||
      typeof body?.comparator !== 'string'
    ) {
      throw new BadRequestException('ALERT_RULE_INVALID');
    }
    try {
      return await this.service.upsertAlertRule(user.role, {
        id: typeof body.id === 'string' ? body.id : undefined,
        name: body.name,
        metric: body.metric,
        threshold: body.threshold,
        comparator: body.comparator as 'gt' | 'gte' | 'lt' | 'lte' | 'eq',
        enabled: body.enabled !== false,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'ALERT_RULE_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('notifications')
  async notifications(@CurrentUser() user: RequestUser) {
    try {
      return { notifications: await this.service.listNotifications(user.role) };
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('alerts/evaluate')
  async evaluate(@CurrentUser() user: RequestUser) {
    try {
      return { notifications: await this.service.evaluateAlerts(user.role) };
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('deploy-runs')
  async deployRuns(@CurrentUser() user: RequestUser) {
    try {
      return { runs: await this.service.listDeployRuns(user.role) };
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('deploy-runs')
  async recordDeploy(
    @CurrentUser() user: RequestUser,
    @Body() body: { action?: unknown; migrationName?: unknown; notes?: unknown },
  ) {
    if (typeof body?.action !== 'string' || typeof body?.migrationName !== 'string') {
      throw new BadRequestException('DEPLOY_RUN_INVALID');
    }
    try {
      return await this.service.recordDeployRun(user.role, user.id, {
        action: body.action,
        migrationName: body.migrationName,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'DEPLOY_RUN_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('load-tests/evaluate')
  async evaluateLoad(
    @CurrentUser() user: RequestUser,
    @Body() body: { samples?: unknown },
  ) {
    if (!Array.isArray(body?.samples)) throw new BadRequestException('LOAD_SAMPLES_EMPTY');
    try {
      return this.service.evaluateLoadTests(user.role, body.samples as never);
    } catch (error) {
      if (error instanceof Error && error.message === 'LOAD_SAMPLES_EMPTY') {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('staging/seed-plan')
  async stagingSeed(
    @CurrentUser() user: RequestUser,
    @Body() body: { envName?: unknown; databaseName?: unknown; profiles?: unknown },
  ) {
    if (
      typeof body?.envName !== 'string' ||
      typeof body?.databaseName !== 'string' ||
      !Array.isArray(body?.profiles)
    ) {
      throw new BadRequestException('STAGING_SEED_INVALID');
    }
    try {
      return {
        users: this.service.buildStagingSeed(
          user.role,
          body.envName,
          body.databaseName,
          body.profiles as never,
        ),
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'STAGING_SEED_INVALID' ||
          error.message === 'STAGING_ENV_INVALID' ||
          error.message === 'STAGING_SEED_PRIMARY_FORBIDDEN')
      ) {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('beta-metrics')
  async betaMetricsFromStore(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.collectBetaMetricsFromStore(user.role);
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('beta-metrics/collect')
  async betaMetricsCollect(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      productEvents?: unknown;
      safetyEscalations?: unknown;
      aiCostUsd?: unknown;
      aiFailures?: unknown;
      requestFailures?: unknown;
    },
  ) {
    try {
      return this.service.collectBetaMetrics(user.role, body as never);
    } catch (error) {
      if (error instanceof Error && error.message === 'BETA_METRICS_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('mvp-deploy/plan')
  mvpDeployPlan(
    @CurrentUser() user: RequestUser,
    @Body() body: { version?: unknown; environment?: unknown; commitSha?: unknown },
  ) {
    if (
      typeof body?.version !== 'string' ||
      typeof body?.environment !== 'string' ||
      typeof body?.commitSha !== 'string'
    ) {
      throw new BadRequestException('MVP_DEPLOY_INVALID');
    }
    try {
      return this.service.planPublicMvpDeploy(user.role, {
        version: body.version,
        environment: body.environment as 'production' | 'staging',
        commitSha: body.commitSha,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'MVP_DEPLOY_VERSION_INVALID' ||
          error.message === 'MVP_DEPLOY_COMMIT_INVALID' ||
          error.message === 'MVP_DEPLOY_ENV_INVALID')
      ) {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('post-release/decide')
  postReleaseDecide(@CurrentUser() user: RequestUser, @Body() body: { checks?: unknown }) {
    if (!Array.isArray(body?.checks)) throw new BadRequestException('POST_RELEASE_CHECKS_INVALID');
    try {
      return this.service.postReleaseDecision(user.role, body.checks as never);
    } catch (error) {
      if (error instanceof Error && error.message === 'POST_RELEASE_CHECKS_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }
}
