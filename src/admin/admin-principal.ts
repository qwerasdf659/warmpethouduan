/**
 * 通过 AdminJwtAuthGuard 后挂在 req.admin 上的身份。
 * 仅含最小身份信息；角色/权限由 RolesGuard 按需从库内实时解析（改权限即时生效）。
 */
export interface AdminPrincipal {
  adminUserId: string;
  username: string;
}

/** 后台 JWT 载荷。typ 固定 'admin'，与玩家端 token 区分，防止串用。 */
export interface AdminJwtPayload {
  sub: string;
  username: string;
  typ: 'admin';
}

export const ADMIN_TOKEN_TYPE = 'admin';
export const SUPER_ADMIN_ROLE = 'super_admin';
