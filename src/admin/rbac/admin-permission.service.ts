import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminPermission } from '../../entities/admin-permission.entity';
import { CreatePermissionDto } from './dto/permission.dto';

@Injectable()
export class AdminPermissionService {
  constructor(
    @InjectRepository(AdminPermission)
    private readonly permissions: Repository<AdminPermission>,
  ) {}

  findAll(): Promise<AdminPermission[]> {
    return this.permissions.find({ order: { group: 'ASC', code: 'ASC' } });
  }

  async create(dto: CreatePermissionDto): Promise<AdminPermission> {
    const exists = await this.permissions.findOne({
      where: { code: dto.code },
    });
    if (exists) throw new ConflictException('权限 code 已存在');
    const entity = this.permissions.create({
      code: dto.code,
      name: dto.name,
      group: dto.group ?? null,
    });
    return this.permissions.save(entity);
  }

  async remove(id: string): Promise<void> {
    const found = await this.permissions.findOne({ where: { id } });
    if (!found) throw new NotFoundException('权限不存在');
    await this.permissions.remove(found);
  }
}
