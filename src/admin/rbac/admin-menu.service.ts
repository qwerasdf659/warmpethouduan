import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminMenu } from '../../entities/admin-menu.entity';
import { CreateMenuDto, UpdateMenuDto } from './dto/menu.dto';

@Injectable()
export class AdminMenuService {
  constructor(
    @InjectRepository(AdminMenu)
    private readonly menus: Repository<AdminMenu>,
  ) {}

  findAll(): Promise<AdminMenu[]> {
    return this.menus.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async create(dto: CreateMenuDto): Promise<AdminMenu> {
    const menu = this.menus.create({
      parentId: dto.parentId ?? null,
      name: dto.name,
      type: dto.type,
      path: dto.path ?? null,
      component: dto.component ?? null,
      icon: dto.icon ?? null,
      permissionCode: dto.permissionCode ?? null,
      sortOrder: dto.sortOrder ?? 0,
      visible: dto.visible ?? true,
    });
    return this.menus.save(menu);
  }

  async update(id: string, dto: UpdateMenuDto): Promise<AdminMenu> {
    const menu = await this.menus.findOne({ where: { id } });
    if (!menu) throw new NotFoundException('菜单不存在');
    if (dto.parentId !== undefined) menu.parentId = dto.parentId ?? null;
    if (dto.name !== undefined) menu.name = dto.name;
    if (dto.type !== undefined) menu.type = dto.type;
    if (dto.path !== undefined) menu.path = dto.path;
    if (dto.component !== undefined) menu.component = dto.component;
    if (dto.icon !== undefined) menu.icon = dto.icon;
    if (dto.permissionCode !== undefined) {
      menu.permissionCode = dto.permissionCode;
    }
    if (dto.sortOrder !== undefined) menu.sortOrder = dto.sortOrder;
    if (dto.visible !== undefined) menu.visible = dto.visible;
    return this.menus.save(menu);
  }

  async remove(id: string): Promise<void> {
    const menu = await this.menus.findOne({ where: { id } });
    if (!menu) throw new NotFoundException('菜单不存在');
    const childCount = await this.menus.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException('请先删除子菜单');
    }
    await this.menus.remove(menu);
  }
}
