import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY, type AccountRole } from '../decorators/roles.decorator';
import { roleSatisfies } from '../domain/account-role.policy';
import type { RequestUser } from '../domain/request-user.types';

/**
 * Role gate with OWNER supremacy.
 * MFA / recent reauthentication are enforced by other guards and never shrink OWNER permissions.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AccountRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    if (!roleSatisfies(request.user?.role, roles)) {
      throw new ForbiddenException('OWNER_ROLE_REQUIRED');
    }
    return true;
  }
}
