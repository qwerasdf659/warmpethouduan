import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from '../../entities/admin-user.entity';
import { AdminMenu } from '../../entities/admin-menu.entity';
import { SUPER_ADMIN_ROLE } from '../admin-principal';

export interface AdminAccess {
  adminUserId: string;
  username: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
}

/**
 * 解析管理员的实时权限视图（角色 → 权限聚合）。
 * 每次鉴权按库查询，保证改权限即时生效；后台流量小，成本可接受。
 * super_admin 视为拥有全部权限/全部菜单。
 */
@Injectable()
export class AdminAccessService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUsers: Repository<AdminUser>,
    @InjectRepository(AdminMenu)
    private readonly menus: Repository<AdminMenu>,
  ) {}

  /** 解析并校验管理员访问权限；账号不存在或被停用则抛 401。 */
  async resolveAccess(adminUserId: string): Promise<AdminAccess> {
    const admin = await this.adminUsers.findOne({
      where: { id: adminUserId },
      relations: { roles: { permissions: true } },
    });
    if (!admin) throw new UnauthorizedException('管理员不存在');
    if (admin.status !== 'active') {
      throw new UnauthorizedException('管理员已被停用');
    }

    const roles = (admin.roles ?? []).map((r) => r.code);
    const isSuperAdmin = roles.includes(SUPER_ADMIN_ROLE);
    const permSet = new Set<string>();
    for (const role of admin.roles ?? []) {
      for (const perm of role.permissions ?? []) permSet.add(perm.code);
    }

    return {
      adminUserId: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      roles,
      permissions: [...permSet],
      isSuperAdmin,
    };
  }

  /**
   * 该管理员可见的菜单（用于前端 ProLayout 渲染）。
   * super_admin 返回全部；否则按「拥有权限点」过滤（permissionCode 为空的菜单默认可见）。
   */
  async resolveMenus(access: AdminAccess): Promise<AdminMenu[]> {
    const all = await this.menus.find({
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    if (access.isSuperAdmin) return all;

    const perms = new Set(access.permissions);
    return all.filter((m) => !m.permissionCode || perms.has(m.permissionCode));
  }
}
