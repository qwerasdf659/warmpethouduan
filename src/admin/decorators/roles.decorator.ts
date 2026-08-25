import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'admin_roles';

/**
 * 要求当前管理员至少具备其中一个角色（按 role.code）。
 * super_admin 恒定放行（在 RolesGuard 内特判）。
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
