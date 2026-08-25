import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AdminUser } from '../../entities/admin-user.entity';
import { AdminRole } from '../../entities/admin-role.entity';
import { hashPassword } from '../utils/password.util';
import { PaginationDto } from '../dto/pagination.dto';
import {
  AssignUserRolesDto,
  CreateAdminUserDto,
  ResetPasswordDto,
  UpdateAdminUserDto,
} from './dto/admin-user.dto';

/** 对外视图：绝不返回 passwordHash。 */
export interface AdminUserView {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
  lastLoginAt: Date | null;
  roles: { id: string; code: string; name: string }[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUsers: Repository<AdminUser>,
    @InjectRepository(AdminRole)
    private readonly roles: Repository<AdminRole>,
  ) {}

  private toView(u: AdminUser): AdminUserView {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      roles: (u.roles ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
      })),
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  async list(
    q: PaginationDto,
  ): Promise<{ list: AdminUserView[]; total: number }> {
    const [rows, total] = await this.adminUsers.findAndCount({
      relations: { roles: true },
      order: { id: 'ASC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { list: rows.map((r) => this.toView(r)), total };
  }

  async get(id: string): Promise<AdminUserView> {
    const u = await this.adminUsers.findOne({
      where: { id },
      relations: { roles: true },
    });
    if (!u) throw new NotFoundException('管理员不存在');
    return this.toView(u);
  }

  async create(dto: CreateAdminUserDto): Promise<AdminUserView> {
    const exists = await this.adminUsers.findOne({
      where: { username: dto.username },
    });
    if (exists) throw new ConflictException('用户名已存在');

    const roles = await this.resolveRoles(dto.roleIds);
    const entity = this.adminUsers.create({
      username: dto.username,
      passwordHash: await hashPassword(dto.password),
      displayName: dto.displayName ?? null,
      status: 'active',
      roles,
    });
    const saved = await this.adminUsers.save(entity);
    return this.get(saved.id);
  }

  async update(id: string, dto: UpdateAdminUserDto): Promise<AdminUserView> {
    const u = await this.adminUsers.findOne({ where: { id } });
    if (!u) throw new NotFoundException('管理员不存在');
    if (dto.displayName !== undefined) u.displayName = dto.displayName;
    if (dto.status !== undefined) u.status = dto.status;
    await this.adminUsers.save(u);
    return this.get(id);
  }

  async setRoles(id: string, dto: AssignUserRolesDto): Promise<AdminUserView> {
    const u = await this.adminUsers.findOne({
      where: { id },
      relations: { roles: true },
    });
    if (!u) throw new NotFoundException('管理员不存在');
    u.roles = await this.resolveRoles(dto.roleIds);
    await this.adminUsers.save(u);
    return this.get(id);
  }

  async resetPassword(id: string, dto: ResetPasswordDto): Promise<void> {
    const u = await this.adminUsers.findOne({ where: { id } });
    if (!u) throw new NotFoundException('管理员不存在');
    u.passwordHash = await hashPassword(dto.newPassword);
    await this.adminUsers.save(u);
  }

  async remove(id: string): Promise<void> {
    const u = await this.adminUsers.findOne({
      where: { id },
      relations: { roles: true },
    });
    if (!u) throw new NotFoundException('管理员不存在');
    if ((u.roles ?? []).some((r) => r.code === 'super_admin')) {
      const superAdminCount = await this.countSuperAdmins();
      if (superAdminCount <= 1) {
        throw new BadRequestException('不能删除最后一个超级管理员');
      }
    }
    await this.adminUsers.remove(u);
  }

  private async resolveRoles(roleIds?: string[]): Promise<AdminRole[]> {
    if (!roleIds || roleIds.length === 0) return [];
    return this.roles.find({ where: { id: In(roleIds) } });
  }

  private async countSuperAdmins(): Promise<number> {
    return this.adminUsers
      .createQueryBuilder('u')
      .innerJoin('u.roles', 'r', 'r.code = :code', { code: 'super_admin' })
      .getCount();
  }
}
