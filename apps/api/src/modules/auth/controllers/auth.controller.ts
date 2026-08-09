import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isPasswordAcceptable } from '../domain/auth.policy';
import { UserAuthService } from '../application/user-auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import {
  clearLegacyOwnerSessionCookie,
  clearLegacyUserSessionCookie,
  clearSessionCookie,
  readSessionTokenFromCookieHeader,
} from '../domain/session-cookie';
import { AuthAbuseBlockedError, AuthAbuseGuardUnavailableError, normalizeClientAddress } from '../domain/auth-abuse.policy';
import type { RequestUser } from '../domain/request-user.types';
import { RequireRecentOwnerReauth } from '../decorators/require-recent-owner-reauth.decorator';
import { Auth01aService } from '../application/auth-01a.service';
import { Auth01bService } from '../application/auth-01b.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(UserAuthService) private readonly userAuth: UserAuthService,
    @Inject(Auth01aService) private readonly auth01a: Auth01aService,
    @Inject(Auth01bService) private readonly auth01b?: Auth01bService,
  ) {}

  @Public()
  @Post('password/check')
  check(@Body() body: { password: string }) {
    return { acceptable: isPasswordAcceptable(body.password) };
  }

  @Public()
  @Post('register')
  async register(
    @Body() body: { email?: unknown; password?: unknown; inviteToken?: unknown; anonymousUserId?: unknown; role?: unknown; roles?: unknown; isOwner?: unknown; tier?: unknown; entitlement?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
      throw new HttpException(publicAuthError('AUTH_INVALID', 'Invalid authentication request.'), HttpStatus.BAD_REQUEST);
    }
    // Ignore any client-supplied role — registration always creates USER.
    void body.role;
    const anonymousUserId = typeof body.anonymousUserId === 'string' ? body.anonymousUserId : undefined;
    const ip = clientAddressFromRequest(req);
    try {
      const result = await this.auth01a.register(body.email, body.password, body.inviteToken, ip, anonymousUserId);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Set-Cookie', result.cookies);
      return { user: result.user };
    } catch (error) {
      throw this.mapError(error, res);
    }
  }

  @Public()
  @Post('recovery/request')
  async recoveryRequest(@Body() body: { email?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    try { return await this.auth01a.requestRecovery(body?.email, clientAddressFromRequest(req)); } catch (error) { throw this.mapError(error, res); }
  }

  @Public()
  @Post('recovery/redeem')
  async recoveryRedeem(@Body() body: { token?: unknown; password?: unknown }, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    try { return await this.auth01a.redeemRecovery(body?.token, body?.password); } catch (error) { throw this.mapError(error, res); }
  }

  @Post('reauth/password')
  async passwordReauth(@CurrentUser() user: RequestUser, @Headers('x-session-token') token: string | undefined, @Headers('cookie') cookie: string | undefined, @Body() body: { password?: unknown }) {
    if (typeof body?.password !== 'string') throw new HttpException(publicAuthError('REAUTH_FAILED', 'Reauthentication failed.'), HttpStatus.UNAUTHORIZED);
    try { return await this.auth01a.reauth(user, token?.trim() || readSessionTokenFromCookieHeader(cookie), body.password); } catch (error) { throw this.mapError(error); }
  }

  @Post('beta-invites')
  @RequireRecentOwnerReauth()
  async createInvite(@CurrentUser() user: RequestUser, @Body() body: { email?: unknown; expiresAt?: unknown }) { return this.auth01a.createInvite(user, body?.email, body?.expiresAt); }

  @Post('beta-invites/resend')
  @RequireRecentOwnerReauth()
  async resendInvite(@CurrentUser() user: RequestUser, @Body() body: { inviteId?: unknown }) { if (typeof body?.inviteId !== 'string') throw new HttpException(publicAuthError('AUTH_INVALID', 'Invalid authentication request.'), HttpStatus.BAD_REQUEST); return this.auth01a.resendInvite(user, body.inviteId); }

  @Post('beta-invites/revoke')
  @RequireRecentOwnerReauth()
  async revokeInvite(@CurrentUser() user: RequestUser, @Body() body: { inviteId?: unknown }) { if (typeof body?.inviteId !== 'string') throw new HttpException(publicAuthError('AUTH_INVALID', 'Invalid authentication request.'), HttpStatus.BAD_REQUEST); return this.auth01a.revokeInvite(user, body.inviteId); }

  @Public()
  @Post('login')
  async login(
    @Body() body: { identifier?: unknown; email?: unknown; password?: unknown; anonymousUserId?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identifier = typeof body?.identifier === 'string' ? body.identifier : body?.email;
    if (typeof identifier !== 'string' || typeof body?.password !== 'string') {
      throw new HttpException(publicAuthError('AUTH_INVALID', 'Invalid authentication request.'), HttpStatus.BAD_REQUEST);
    }
    const anonymousUserId = typeof body.anonymousUserId === 'string' ? body.anonymousUserId : undefined;
    const ip = clientAddressFromRequest(req);
    try {
      const result = await this.userAuth.login(identifier, body.password, anonymousUserId, ip);
      res.setHeader('Cache-Control', 'no-store');
      if (result.cookies.length) res.setHeader('Set-Cookie', result.cookies);
      return { user: result.user };
    } catch (error) {
      throw this.mapError(error, res);
    }
  }

  @Public()
  @Post('mfa/challenge')
  async verifyMfaChallenge(
    @Body() body: { challengeId?: unknown; code?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof body?.challengeId !== 'string' || typeof body?.code !== 'string') {
      throw new HttpException(publicAuthError('MFA_INVALID_CODE', 'Invalid verification code.'), HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.userAuth.verifyOwnerMfaChallenge(body.challengeId, body.code, clientAddressFromRequest(req));
      res.setHeader('Set-Cookie', result.cookies);
      return { user: result.user };
    } catch (error) {
      throw this.mapError(error, res);
    }
  }

  @Post('owner-mfa/enroll/start')
  async startOwnerMfaEnrollment(@CurrentUser() user: RequestUser, @Body() body: { password?: unknown }) {
    if (typeof body?.password !== 'string') {
      throw new HttpException(publicAuthError('REAUTH_FAILED', 'Reauthentication failed.'), HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.userAuth.startOwnerMfaEnrollment(user, body.password);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('owner-mfa/enroll/confirm')
  async confirmOwnerMfaEnrollment(
    @CurrentUser() user: RequestUser,
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { enrollmentId?: unknown; code?: unknown },
  ) {
    if (typeof body?.enrollmentId !== 'string' || typeof body?.code !== 'string') {
      throw new HttpException(publicAuthError('MFA_INVALID_CODE', 'Invalid verification code.'), HttpStatus.BAD_REQUEST);
    }
    const rawToken = token?.trim() || readSessionTokenFromCookieHeader(cookie);
    try {
      return await this.userAuth.confirmOwnerMfaEnrollment(user, body.enrollmentId, body.code, rawToken);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('owner-mfa/enroll/cancel')
  async cancelOwnerMfaEnrollment(@CurrentUser() user: RequestUser, @Body() body: { enrollmentId?: unknown }) {
    if (typeof body?.enrollmentId !== 'string') {
      throw new HttpException(publicAuthError('AUTH_INVALID', 'Invalid authentication request.'), HttpStatus.BAD_REQUEST);
    }
    return this.userAuth.cancelOwnerMfaEnrollment(user, body.enrollmentId);
  }

  @Post('owner-mfa/recovery-codes/regenerate')
  @RequireRecentOwnerReauth()
  async regenerateRecoveryCodes(@CurrentUser() user: RequestUser) {
    try {
      return await this.userAuth.regenerateRecoveryCodes(user);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('owner-mfa/reauth')
  async recentOwnerReauth(
    @CurrentUser() user: RequestUser,
    @Headers('x-session-token') token: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Body() body: { password?: unknown },
  ) {
    if (typeof body?.password !== 'string') {
      throw new HttpException(publicAuthError('REAUTH_FAILED', 'Reauthentication failed.'), HttpStatus.BAD_REQUEST);
    }
    const rawToken = token?.trim() || readSessionTokenFromCookieHeader(cookie);
    try {
      return await this.userAuth.recentOwnerReauth(user, rawToken, body.password);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Public()
  @Post('logout')
  async logout(@Headers('x-session-token') token: string | undefined, @Headers('cookie') cookie: string | undefined, @Res({ passthrough: true }) res: Response) {
    const rawToken = token?.trim() || readSessionTokenFromCookieHeader(cookie);
    const result = await this.userAuth.logout(rawToken);
    res.setHeader('Set-Cookie', result.cookies);
    return { ok: true };
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: RequestUser, @Headers('x-session-token') token: string | undefined, @Headers('cookie') cookie: string | undefined) {
    return this.requireAuth01b().listSessions(user, token?.trim() || readSessionTokenFromCookieHeader(cookie));
  }

  @Post('sessions/:sessionId/revoke')
  async revokeSession(@CurrentUser() user: RequestUser, @Param('sessionId') sessionId: string) {
    return this.requireAuth01b().revokeSession(user, sessionId);
  }

  @Post('sessions/revoke-others')
  async revokeOtherSessions(@CurrentUser() user: RequestUser, @Headers('x-session-token') token: string | undefined, @Headers('cookie') cookie: string | undefined) {
    return this.requireAuth01b().revokeOtherSessions(user, token?.trim() || readSessionTokenFromCookieHeader(cookie));
  }

  @Post('sessions/revoke-all')
  async revokeAllSessions(@CurrentUser() user: RequestUser) {
    return this.requireAuth01b().revokeAllSessions(user);
  }

  @Post('privacy/export')
  async exportPrivacy(@CurrentUser() user: RequestUser) {
    try {
      return await this.requireAuth01b().exportAccount(user);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('account/delete')
  async deleteAccount(
    @CurrentUser() user: RequestUser,
    @Body() body: { confirmation?: unknown },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.requireAuth01b().deleteAccount(user, body?.confirmation);
      res.setHeader('Set-Cookie', [clearSessionCookie(), clearLegacyUserSessionCookie(), clearLegacyOwnerSessionCookie()]);
      return result;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    try {
      return await this.userAuth.me(user.id, user.role);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown, res?: Response) {
    if (!(error instanceof Error)) return error;
    if (error instanceof AuthAbuseBlockedError) {
      res?.setHeader('Retry-After', String(error.retryAfterSeconds));
      return new HttpException(
        publicAuthError(error.reason === 'challenge_throttle' ? 'MFA_TEMPORARILY_BLOCKED' : 'AUTH_TEMPORARILY_BLOCKED', 'Authentication is temporarily unavailable.', {
          retryAfterSeconds: error.retryAfterSeconds,
        }),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (error.message === 'MFA_ENROLLMENT_REQUIRED') {
      return new HttpException(publicAuthError('MFA_ENROLLMENT_REQUIRED', 'MFA enrollment is required.'), HttpStatus.FORBIDDEN);
    }
    if (error.message === 'MFA_INVALID_CODE') {
      return new HttpException(publicAuthError('MFA_INVALID_CODE', 'Invalid verification code.'), HttpStatus.UNAUTHORIZED);
    }
    if (error.message === 'MFA_CHALLENGE_EXPIRED') {
      return new HttpException(publicAuthError('MFA_CHALLENGE_EXPIRED', 'Verification challenge expired.'), HttpStatus.UNAUTHORIZED);
    }
    if (error.message === 'REAUTH_FAILED') {
      return new HttpException(publicAuthError('REAUTH_FAILED', 'Reauthentication failed.'), HttpStatus.UNAUTHORIZED);
    }
    if (error instanceof AuthAbuseGuardUnavailableError || error.message === 'AUTH_ABUSE_GUARD_UNAVAILABLE') {
      return new HttpException(publicAuthError('AUTH_ABUSE_GUARD_UNAVAILABLE', 'Authentication abuse guard is unavailable.'), HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error.message === 'RECENT_REAUTH_REQUIRED') {
      return new HttpException(publicAuthError('RECENT_REAUTH_REQUIRED', 'Recent reauthentication is required.'), HttpStatus.FORBIDDEN);
    }
    if (error.message === 'DELETE_CONFIRMATION_REQUIRED') {
      return new HttpException(publicAuthError('DELETE_CONFIRMATION_REQUIRED', 'Account deletion confirmation is required.'), HttpStatus.BAD_REQUEST);
    }
    if (error.message === 'LAST_OWNER_DELETION_BLOCKED') {
      return new HttpException(publicAuthError('LAST_OWNER_DELETION_BLOCKED', 'The last active OWNER account cannot be deleted.'), HttpStatus.CONFLICT);
    }
    if (['INVITE_REQUIRED', 'INVITE_INVALID', 'EMAIL_INVALID', 'RECOVERY_INVALID', 'INVITE_EXPIRY_INVALID'].includes(error.message)) {
      return new HttpException(publicAuthError(error.message, 'Authentication request rejected.'), HttpStatus.BAD_REQUEST);
    }
    if (error.message === 'MFA_REQUIRED') {
      return new HttpException(publicAuthError('MFA_CHALLENGE_REQUIRED', 'Additional verification is required.'), HttpStatus.FORBIDDEN);
    }
    if (error.message === 'SESSION_REQUIRED' || error.message === 'SESSION_NOT_FOUND') {
      return new HttpException(publicAuthError('AUTH_REQUIRED', 'Authentication is required.'), HttpStatus.UNAUTHORIZED);
    }
    if (error.message === 'OWNER_ACCESS_FORBIDDEN') {
      return new HttpException(publicAuthError('OWNER_ACCESS_FORBIDDEN', 'Owner access forbidden.'), HttpStatus.FORBIDDEN);
    }
    if (error.message === 'INVALID_CREDENTIALS' || error.message === 'AUTH_REQUIRED') {
      return new HttpException(
        publicAuthError('INVALID_CREDENTIALS', 'Invalid credentials.'),
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (
      error.message === 'EMAIL_ALREADY_EXISTS' ||
      error.message === 'EMAIL_REQUIRED' ||
      error.message === 'PASSWORD_POLICY_VIOLATION' ||
      error.message === 'ANONYMOUS_INVALID' ||
      error.message === 'ANONYMOUS_ALREADY_MIGRATED'
    ) {
      return new HttpException(publicAuthError('AUTH_REQUEST_REJECTED', 'Authentication request rejected.'), HttpStatus.BAD_REQUEST);
    }
    return error;
  }

  private requireAuth01b(): Auth01bService {
    if (!this.auth01b) throw new Error('AUTH_01B_SERVICE_UNAVAILABLE');
    return this.auth01b;
  }
}

function clientAddressFromRequest(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return normalizeClientAddress(header ?? req.ip ?? req.socket.remoteAddress);
}

function publicAuthError(code: string, message: string, extra?: Record<string, unknown>) {
  return {
    error: {
      code,
      message,
      ...extra,
    },
  };
}
