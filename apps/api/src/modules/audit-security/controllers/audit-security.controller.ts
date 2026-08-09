import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { OwnerMfaGuard } from '../../auth/guards/owner-mfa.guard';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { resolveSessionTokenFromHeaders } from '../../auth/domain/session-cookie';
import { AuditSecurityService } from '../application/audit-security.service';
import { UserAuthService } from '../../auth/application/user-auth.service';
import { RequireRecentOwnerReauth } from '../../auth/decorators/require-recent-owner-reauth.decorator';

/**
 * Destructive reauth + encrypted backup + isolated restore test + security ops.
 * No production restore / factory-reset / drop-database endpoints exist.
 * AuditEvent remains append-only (no update/delete API).
 */
@Controller('audit-security')
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles('OWNER')
export class AuditSecurityController {
  constructor(
    @Inject(AuditSecurityService) private readonly service: AuditSecurityService,
    @Inject(UserAuthService) private readonly userAuth: UserAuthService,
  ) {}

  @Post('reauth')
  async reauth(
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @CurrentUser() user: RequestUser,
    @Body() body: { action?: unknown; confirmation?: unknown; password?: unknown },
  ) {
    if (typeof body?.action !== 'string') {
      throw new BadRequestException('DESTRUCTIVE_REAUTH_INVALID');
    }
    const sessionToken = resolveSessionTokenFromHeaders({ token, cookie });
    try {
      if (typeof body.password === 'string') {
        const result = await this.userAuth.recentOwnerReauth(user, sessionToken, body.password);
        return { action: body.action, ...result };
      }
      if (typeof body.confirmation !== 'string') throw new Error('DESTRUCTIVE_REAUTH_INVALID');
      return await this.service.reauthenticate(sessionToken, { action: body.action, confirmation: body.confirmation });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'DESTRUCTIVE_ACTION_INVALID' || error.message === 'DESTRUCTIVE_CONFIRMATION_REQUIRED')
      ) {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('backups')
  @RequireRecentOwnerReauth()
  async createBackup(
    @CurrentUser() user: RequestUser,
    @Body() body: { idempotencyKey?: unknown; plaintext?: unknown },
  ) {
    if (typeof body?.idempotencyKey !== 'string' || typeof body?.plaintext !== 'string') {
      throw new BadRequestException('BACKUP_JOB_INVALID');
    }
    try {
      return await this.service.createEncryptedBackup(user.role, {
        idempotencyKey: body.idempotencyKey,
        actorUserId: user.id,
        plaintext: body.plaintext,
      });
    } catch (error) {
      return this.mapBackupError(error);
    }
  }

  @Get('backups/:id')
  async getBackup(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.getBackup(user.role, id);
    } catch (error) {
      return this.mapBackupError(error);
    }
  }

  @Post('backups/:id/verify')
  @RequireRecentOwnerReauth()
  async verifyBackup(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.verifyBackupDecrypt(user.role, id);
    } catch (error) {
      return this.mapBackupError(error);
    }
  }

  @Post('restore/plan')
  @RequireRecentOwnerReauth()
  async restorePlan(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      backupId?: unknown;
      storageKey?: unknown;
      environment?: unknown;
      dryRun?: unknown;
      confirmedByOwner?: unknown;
      confirmation?: unknown;
    },
  ) {
    if (
      typeof body?.backupId !== 'string' ||
      typeof body?.storageKey !== 'string' ||
      typeof body?.environment !== 'string' ||
      typeof body?.confirmation !== 'string' ||
      typeof body?.dryRun !== 'boolean' ||
      typeof body?.confirmedByOwner !== 'boolean'
    ) {
      throw new BadRequestException('RESTORE_INPUT_INVALID');
    }
    try {
      return this.service.planRestore(user.role, {
        backupId: body.backupId,
        storageKey: body.storageKey,
        environment: body.environment as 'isolated' | 'staging' | 'production',
        dryRun: body.dryRun,
        confirmedByOwner: body.confirmedByOwner,
        confirmation: body.confirmation,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('RESTORE_')) {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('restore/test')
  @RequireRecentOwnerReauth()
  async restoreTest(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      sourceBackupJobId?: unknown;
      mode?: unknown;
      environment?: unknown;
      dryRun?: unknown;
      confirmedByOwner?: unknown;
      confirmation?: unknown;
    },
  ) {
    if (
      typeof body?.sourceBackupJobId !== 'string' ||
      body?.mode !== 'test' ||
      body?.environment !== 'isolated' ||
      typeof body?.dryRun !== 'boolean' ||
      typeof body?.confirmedByOwner !== 'boolean' ||
      typeof body?.confirmation !== 'string'
    ) {
      throw new BadRequestException('RESTORE_TEST_INPUT_INVALID');
    }
    try {
      return await this.service.runIsolatedRestoreTest(user.role, user.id, {
        sourceBackupJobId: body.sourceBackupJobId,
        mode: 'test',
        environment: 'isolated',
        dryRun: body.dryRun,
        confirmedByOwner: body.confirmedByOwner,
        confirmation: body.confirmation,
      });
    } catch (error) {
      return this.mapBackupError(error);
    }
  }

  @Get('restore/test/:id')
  async getRestoreTest(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.getRestoreTestResult(user.role, id);
    } catch (error) {
      return this.mapBackupError(error);
    }
  }

  @Post('secrets/scan')
  @RequireRecentOwnerReauth()
  async scanSecrets(
    @CurrentUser() user: RequestUser,
    @Body() body: { path?: unknown; content?: unknown },
  ) {
    if (typeof body?.path !== 'string' || typeof body?.content !== 'string') {
      throw new BadRequestException('SECRET_SCAN_INVALID');
    }
    try {
      return this.service.scanSecrets(user.role, body.path, body.content);
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Get('threats')
  async listThreats(@CurrentUser() user: RequestUser) {
    try {
      return { reviews: await this.service.listThreatReviews(user.role) };
    } catch {
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('threats')
  @RequireRecentOwnerReauth()
  async upsertThreat(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      title?: unknown;
      category?: unknown;
      severity?: unknown;
      status?: unknown;
      abuseCase?: unknown;
      mitigation?: unknown;
    },
  ) {
    if (
      typeof body?.title !== 'string' ||
      typeof body?.category !== 'string' ||
      typeof body?.severity !== 'string' ||
      typeof body?.status !== 'string' ||
      typeof body?.abuseCase !== 'string' ||
      typeof body?.mitigation !== 'string'
    ) {
      throw new BadRequestException('THREAT_REVIEW_INVALID');
    }
    try {
      return await this.service.upsertThreatReview(user.role, {
        title: body.title,
        category: body.category,
        severity: body.severity as 'low' | 'medium' | 'high' | 'critical',
        status: body.status as 'open' | 'mitigated' | 'accepted',
        abuseCase: body.abuseCase,
        mitigation: body.mitigation,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'THREAT_REVIEW_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('incidents/plan')
  async incidentPlan(
    @CurrentUser() user: RequestUser,
    @Body() body: { id?: unknown; title?: unknown; severity?: unknown },
  ) {
    if (typeof body?.id !== 'string' || typeof body?.title !== 'string' || typeof body?.severity !== 'string') {
      throw new BadRequestException('INCIDENT_PLAN_INVALID');
    }
    try {
      return this.service.incidentPlan(user.role, {
        id: body.id,
        title: body.title,
        severity: body.severity as 'sev1' | 'sev2' | 'sev3' | 'sev4',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'INCIDENT_PLAN_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('release-gate')
  @RequireRecentOwnerReauth()
  async releaseGate(
    @CurrentUser() user: RequestUser,
    @Body() body: { checks?: unknown },
  ) {
    if (!Array.isArray(body?.checks)) throw new BadRequestException('SECURITY_GATE_INVALID');
    try {
      return this.service.securityReleaseGate(user.role, body.checks as never);
    } catch (error) {
      if (error instanceof Error && error.message === 'SECURITY_GATE_INVALID') {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  @Post('final-rehearsal/plan')
  async finalRehearsalPlan(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      targetDatabase?: unknown;
      includeBackup?: unknown;
      includeRestore?: unknown;
      includeSecurityGate?: unknown;
    },
  ) {
    if (typeof body?.targetDatabase !== 'string') {
      throw new BadRequestException('FINAL_REHEARSAL_INVALID');
    }
    try {
      return this.service.finalRehearsalPlan(user.role, {
        targetDatabase: body.targetDatabase,
        includeBackup: body.includeBackup === true,
        includeRestore: body.includeRestore === true,
        includeSecurityGate: body.includeSecurityGate === true,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'FINAL_REHEARSAL_INVALID' ||
          error.message === 'FINAL_REHEARSAL_PRIMARY_FORBIDDEN' ||
          error.message === 'FINAL_REHEARSAL_TARGET_INVALID')
      ) {
        throw new BadRequestException(error.message);
      }
      throw new UnauthorizedException('OWNER_ACCESS_FORBIDDEN');
    }
  }

  private mapBackupError(error: unknown): never {
    if (!(error instanceof Error)) throw new BadRequestException('BACKUP_FAILED');
    if (error.message === 'OWNER_ACCESS_FORBIDDEN') throw new UnauthorizedException(error.message);
    if (error.message === 'BACKUP_JOB_NOT_FOUND' || error.message === 'RESTORE_TEST_NOT_FOUND') {
      throw new NotFoundException(error.message);
    }
    if (
      error.message === 'BACKUP_JOB_INVALID' ||
      error.message === 'BACKUP_PAYLOAD_TOO_LARGE' ||
      error.message === 'BACKUP_KEY_INVALID' ||
      error.message === 'BACKUP_ENVELOPE_INVALID' ||
      error.message === 'BACKUP_STORAGE_MISSING' ||
      error.message === 'BACKUP_STORAGE_KEY_INVALID' ||
      error.message.startsWith('RESTORE_')
    ) {
      throw new BadRequestException(error.message);
    }
    throw new BadRequestException('BACKUP_FAILED');
  }
}
