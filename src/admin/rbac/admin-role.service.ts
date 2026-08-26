import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AdminRole } from '../../entities/admin-role.entity';
import { AdminPermission } from '../../entities/admin-permission.entity';
import {
  AssignRolePermissionsDto,
  CreateRoleDto,
  UpdateRoleDto,
} from './dto/role.dto';

@Injectable()
export class AdminRoleService {
  constructor(
    @InjectRepository(AdminRole)
    private readonly roles: Repository<AdminRole>,
    @InjectRepository(AdminPermission)
    private readonly permissions: Repository<AdminPermission>,
  ) {}

  findAll(): Promise<AdminRole[]> {
    return this.roles.find({
      relations: { permissions: true },
      order: { id: 'ASC' },
    });
  }

  async findOne(id: string): Promise<AdminRole> {
    const role = await this.roles.findOne({
      where: { id },
      relations: { permissions: true },
    });
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  async create(dto: CreateRoleDto): Promise<AdminRole> {
    const exists = await this.roles.findOne({ where: { code: dto.code } });
    if (exists) throw new ConflictException('角色 code 已存在');
    const role = this.roles.create({
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      isSystem: false,
      permissions: [],
    });
    return this.roles.save(role);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<AdminRole> {
    const role = await this.findOne(id);
    if (dto.name !== undefined) role.name = dto.name;
    if (dto.description !== undefined) role.description = dto.description;
    return this.roles.save(role);
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);
    if (role.isSystem) {
      throw new BadRequestException('内置角色不可删除');
    }
    await this.roles.remove(role);
  }

  async setPermissions(
    id: string,
    dto: AssignRolePermissionsDto,
  ): Promise<AdminRole> {
    const role = await this.findOne(id);
    role.permissions =
      dto.permissionIds.length === 0
        ? []
        : await this.permissions.find({
            where: { id: In(dto.permissionIds) },
          });
    return this.roles.save(role);
  }
}
