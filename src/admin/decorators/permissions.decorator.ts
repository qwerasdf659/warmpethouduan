import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'admin_permissions';

/**
 * 要求当前管理员具备全部列出的权限点（按 permission.code，如 'player:read'）。
 * super_admin 恒定放行（在 RolesGuard 内特判）。
 */
export const RequirePermissions = (...perms: string[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);
