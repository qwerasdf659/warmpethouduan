import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AdminPrincipal } from '../admin-principal';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AdminAccessService } from '../services/admin-access.service';

/**
 * 后台授权守卫：在 AdminJwtAuthGuard 之后运行。
 * 读取 @RequirePermissions 元数据，按库实时解析管理员权限校验：
 *  - super_admin 直接放行；
 *  - 其余必须具备**全部**所列权限点。
 * 未标注任何要求的接口，仅需登录即可（由 AdminJwtAuthGuard 保证）。
 *
 * 授权只认权限点、不认角色名：角色是权限的**编排单位**，可由运营在后台随意增删改，
 * 拿角色名写死在代码里等于把「运营改了个角色名」变成一次线上越权或全员 403。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AdminAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPerms = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPerms || requiredPerms.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { admin: AdminPrincipal }>();
    const access = await this.access.resolveAccess(req.admin.adminUserId);
    if (access.isSuperAdmin) return true;

    const permSet = new Set(access.permissions);
    const missing = requiredPerms.filter((p) => !permSet.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`缺少权限：${missing.join(', ')}`);
    }

    return true;
  }
}
