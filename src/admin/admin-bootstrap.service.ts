import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { AdminRole } from '../entities/admin-role.entity';
import { AdminPermission } from '../entities/admin-permission.entity';
import { AdminMenu } from '../entities/admin-menu.entity';
import { LockService } from '../common/lock/lock.service';
import { SUPER_ADMIN_ROLE } from './admin-principal';
import { hashPassword, verifyPassword } from './utils/password.util';
import { SEED_MENUS, SEED_PERMISSIONS } from './admin-seed';

/**
 * 后台初始化播种（幂等）：
 *  1. 同步权限点（按 code upsert，不删除既有）；
 *  2. 确保 super_admin 内置角色存在并拥有全部权限；
 *  3. 菜单表为空时写入基础菜单树；
 *  4. 库内无任何管理员且配置了 ADMIN_INIT_PASSWORD 时，创建默认超管。
 * 用分布式锁避免多进程/多实例并发重复播种。
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminBootstrap');

  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUsers: Repository<AdminUser>,
    @InjectRepository(AdminRole)
    private readonly roles: Repository<AdminRole>,
    @InjectRepository(AdminPermission)
    private readonly permissions: Repository<AdminPermission>,
    @InjectRepository(AdminMenu)
    private readonly menus: Repository<AdminMenu>,
    private readonly lock: LockService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.lock.withLock('admin:bootstrap', () => this.seed(), {
        ttlMs: 30_000,
        retries: 3,
        retryDelayMs: 500,
      });
    } catch (err) {
      // 软失败：播种失败不应阻断应用启动，仅告警
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`后台播种跳过/失败（已忽略）: ${msg}`);
    }
  }

  private async seed(): Promise<void> {
    await this.syncPermissions();
    const superRole = await this.ensureSuperAdminRole();
    await this.seedMissingMenus();
    await this.ensureInitialAdmin(superRole);
    await this.warnIfInitPasswordStale();
  }

  private async syncPermissions(): Promise<void> {
    const existing = await this.permissions.find();
    const known = new Set(existing.map((p) => p.code));
    const toInsert = SEED_PERMISSIONS.filter((p) => !known.has(p.code)).map(
      (p) =>
        this.permissions.create({
          code: p.code,
          name: p.name,
          group: p.group,
        }),
    );
    if (toInsert.length > 0) {
      await this.permissions.save(toInsert);
      this.logger.log(`同步权限点 +${toInsert.length}`);
    }
  }

  private async ensureSuperAdminRole(): Promise<AdminRole> {
    const allPerms = await this.permissions.find();
    let role = await this.roles.findOne({
      where: { code: SUPER_ADMIN_ROLE },
      relations: { permissions: true },
    });
    if (!role) {
      role = this.roles.create({
        code: SUPER_ADMIN_ROLE,
        name: '超级管理员',
        description: '拥有全部权限，系统内置',
        isSystem: true,
        permissions: allPerms,
      });
      await this.roles.save(role);
      this.logger.log('创建内置角色 super_admin');
      return role;
    }
    // 补齐后来新增的权限点
    const owned = new Set((role.permissions ?? []).map((p) => p.id));
    if (allPerms.some((p) => !owned.has(p.id))) {
      role.permissions = allPerms;
      await this.roles.save(role);
      this.logger.log('super_admin 权限已补齐至全量');
    }
    return role;
  }

  /**
   * 幂等插入缺失菜单（按 path 匹配已存在项）。既支持首次全量播种，
   * 也能在后续版本追加新菜单而不重复写入既有项。
   */
  private async seedMissingMenus(): Promise<void> {
    const existing = await this.menus.find();
    const pathToId = new Map<string, string>(
      existing.filter((m) => m.path).map((m) => [m.path as string, m.id]),
    );
    const keyToId = new Map<string, string>();
    for (const m of SEED_MENUS) {
      if (m.path && pathToId.has(m.path))
        keyToId.set(m.key, pathToId.get(m.path)!);
    }

    let added = 0;
    for (const m of SEED_MENUS) {
      if (m.path && pathToId.has(m.path)) continue;
      const saved = await this.menus.save(
        this.menus.create({
          parentId: m.parentKey ? (keyToId.get(m.parentKey) ?? null) : null,
          name: m.name,
          type: m.type,
          path: m.path,
          component: m.component,
          icon: m.icon,
          permissionCode: m.permissionCode,
          sortOrder: m.sortOrder,
          visible: true,
        }),
      );
      keyToId.set(m.key, saved.id);
      if (m.path) pathToId.set(m.path, saved.id);
      added++;
    }
    if (added > 0) this.logger.log(`写入缺失菜单 ${added} 项`);
  }

  private async ensureInitialAdmin(superRole: AdminRole): Promise<void> {
    const total = await this.adminUsers.count();
    if (total > 0) return;

    const username = this.config.get<string>('admin.initUsername') ?? 'admin';
    const password = this.config.get<string>('admin.initPassword') ?? '';
    if (!password) {
      this.logger.warn(
        '库内无管理员且未配置 ADMIN_INIT_PASSWORD，跳过默认超管创建。' +
          '请设置后重启，或手动插入首个管理员。',
      );
      return;
    }

    const admin = this.adminUsers.create({
      username,
      passwordHash: await hashPassword(password),
      displayName: '超级管理员',
      status: 'active',
      roles: [superRole],
    });
    await this.adminUsers.save(admin);
    this.logger.log(`已创建默认超管：${username}（请尽快登录改密）`);
  }

  /**
   * 启动自检：`.env` 的 ADMIN_INIT_PASSWORD 是否还等于该账号的真实口令。
   *
   * 这个变量在代码里只有一个作用——库为空时播种，`ensureInitialAdmin` 一开头就
   * `count() > 0 就 return`。但 `.env` 的注释把它同时当成了「口令备忘录」
   * （压平迁移重建库时要靠它，理由写在那行注释里）。两个职责会打架：
   * 后台「系统管理 → 管理员 → 重置密码」走的是 AdminUserService.resetPassword，
   * 只改库不碰 `.env`，于是备忘录会**静默变成旧值**，等到下次重建库才发现登不进去。
   *
   * 这里不去消灭那个双职责（明文备忘是有意为之），只把静默漂移变成每次启动喊一声。
   * 不打印任何口令内容；账号不存在或未配置口令都属正常，直接跳过。
   * 想一次改好两边用 `npm run admin:passwd`，它会同时改库和 `.env`。
   */
  private async warnIfInitPasswordStale(): Promise<void> {
    const username = this.config.get<string>('admin.initUsername') ?? 'admin';
    const password = this.config.get<string>('admin.initPassword') ?? '';
    if (!password) return;

    const admin = await this.adminUsers.findOne({ where: { username } });
    if (!admin) return;

    if (!(await verifyPassword(password, admin.passwordHash))) {
      this.logger.warn(
        `.env 的 ADMIN_INIT_PASSWORD 与账号 ${username} 的实际口令已不一致。` +
          '重建数据库时会按 .env 里的旧口令播种，届时将登录失败。' +
          '用 `npm run admin:passwd` 改密可同时更新两边。',
      );
    }
  }
}
