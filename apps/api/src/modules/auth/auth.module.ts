import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './application/auth.service';
import { UserAuthService } from './application/user-auth.service';
import { SessionAuthService } from './application/session-auth.service';
import { AuthRepository } from './infrastructure/auth.repository';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { RolesGuard } from './guards/roles.guard';
import { OwnerMfaGuard } from './guards/owner-mfa.guard';
import { RecentOwnerReauthGuard } from './guards/recent-owner-reauth.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserAuthService,
    SessionAuthService,
    AuthRepository,
    RolesGuard,
    OwnerMfaGuard,
    RecentOwnerReauthGuard,
    // CSRF/origin runs before session auth so rejects are stable even without a user.
    { provide: APP_GUARD, useClass: CsrfOriginGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RecentOwnerReauthGuard },
  ],
  exports: [AuthService, UserAuthService, SessionAuthService, AuthRepository, RolesGuard, OwnerMfaGuard, RecentOwnerReauthGuard],
})
export class AuthModule {}
