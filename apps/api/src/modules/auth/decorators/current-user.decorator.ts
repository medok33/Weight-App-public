import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestUser } from '../domain/request-user.types';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
  return request.user;
});
