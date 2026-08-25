import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from '../../entities/admin-user.entity';
import { ADMIN_TOKEN_TYPE, AdminJwtPayload } from '../admin-principal';
import { verifyPassword } from '../utils/password.util';
import { AdminAccessService } from '../services/admin-access.service';

export interface AdminProfile {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
  menus: unknown[];
}

export interface AdminLoginResult {
  token: string;
  profile: AdminProfile;
}

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUsers: Repository<AdminUser>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly access: AdminAccessService,
  ) {}

  /**
   * 后台登录：用户名+口令校验 → 校验状态 → 自签带 typ:'admin' 的 JWT。
   * 用户名不存在与口令错误返回同一提示，避免账号枚举。
   */
  async login(username: string, password: string): Promise<AdminLoginResult> {
    const admin = await this.adminUsers.findOne({ where: { username } });
    const invalid = new UnauthorizedException('用户名或密码错误');
    if (!admin) {
      // 仍做一次散列比较，抹平存在/不存在的时间差
      await verifyPassword(password, 'scrypt$00$00');
      throw invalid;
    }
    const ok = await verifyPassword(password, admin.passwordHash);
    if (!ok) throw invalid;
    if (admin.status !== 'active') {
      throw new UnauthorizedException('管理员已被停用');
    }

    admin.lastLoginAt = new Date();
    await this.adminUsers.save(admin);

    const payload: AdminJwtPayload = {
      sub: admin.id,
      username: admin.username,
      typ: ADMIN_TOKEN_TYPE,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: (this.config.get<string>('admin.jwtExpiresIn') ??
        '1d') as unknown as number,
    });

    const profile = await this.buildProfile(admin.id);
    return { token, profile };
  }

  /** 组装前端所需的身份档案（角色、权限点、可见菜单）。 */
  async buildProfile(adminUserId: string): Promise<AdminProfile> {
    const access = await this.access.resolveAccess(adminUserId);
    const menus = await this.access.resolveMenus(access);
    return {
      id: access.adminUserId,
      username: access.username,
      displayName: access.displayName,
      roles: access.roles,
      permissions: access.permissions,
      menus,
    };
  }
}
