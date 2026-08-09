import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export type AccountRole = 'USER' | 'ADMIN' | 'OWNER';

export const Roles = (...roles: AccountRole[]) => SetMetadata(ROLES_KEY, roles);
