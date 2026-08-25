import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AdminPrincipal } from '../admin-principal';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AdminAccessService } from '../services/admin-access.service';

/**
 * 后台授权守卫：在 AdminJwtAuthGuard 之后运行。
 * 读取 @Roles / @RequirePermissions 元数据，按库实时解析管理员权限校验：
 *  - super_admin 直接放行；
 *  - @Roles：命中任一角色即可；
 *  - @RequirePermissions：必须具备全部所列权限点。
 * 未标注任何要求的接口，仅需登录即可（由 AdminJwtAuthGuard 保证）。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AdminAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredPerms = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      (!requiredRoles || requiredRoles.length === 0) &&
      (!requiredPerms || requiredPerms.length === 0)
    ) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { admin: AdminPrincipal }>();
    const access = await this.access.resolveAccess(req.admin.adminUserId);
    if (access.isSuperAdmin) return true;

    if (requiredRoles && requiredRoles.length > 0) {
      const ok = requiredRoles.some((r) => access.roles.includes(r));
      if (!ok) throw new ForbiddenException('角色不足，无权访问');
    }

    if (requiredPerms && requiredPerms.length > 0) {
      const permSet = new Set(access.permissions);
      const missing = requiredPerms.filter((p) => !permSet.has(p));
      if (missing.length > 0) {
        throw new ForbiddenException(`缺少权限：${missing.join(', ')}`);
      }
    }

    return true;
  }
}
