import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemDef } from '../../entities/item-def.entity';
import { CreateItemDefDto, UpdateItemDefDto } from './dto/item-def.dto';

/** 物品定义（换装/家具）后台 CRUD。 */
@Injectable()
export class AdminItemsService {
  constructor(
    @InjectRepository(ItemDef)
    private readonly defs: Repository<ItemDef>,
  ) {}

  async list(type?: string): Promise<{ list: ItemDef[] }> {
    const list = await this.defs.find({
      where: type ? { type: type as ItemDef['type'] } : {},
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    return { list };
  }

  async create(dto: CreateItemDefDto): Promise<{ item: ItemDef }> {
    const exists = await this.defs.findOne({ where: { key: dto.key } });
    if (exists) throw new BadRequestException('物品 key 已存在');
    const item = await this.defs.save(
      this.defs.create({
        key: dto.key,
        type: dto.type,
        name: dto.name,
        slot: dto.slot ?? null,
        price: dto.price,
        pool: dto.pool,
        comfort: dto.comfort ?? 0,
        meta: dto.meta ?? {},
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
    return { item };
  }

  async update(id: string, dto: UpdateItemDefDto): Promise<{ item: ItemDef }> {
    const item = await this.defs.findOne({ where: { id } });
    if (!item) throw new NotFoundException('物品不存在');
    Object.assign(item, {
      name: dto.name ?? item.name,
      slot: dto.slot ?? item.slot,
      price: dto.price ?? item.price,
      pool: dto.pool ?? item.pool,
      comfort: dto.comfort ?? item.comfort,
      meta: dto.meta ?? item.meta,
      enabled: dto.enabled ?? item.enabled,
      sortOrder: dto.sortOrder ?? item.sortOrder,
    });
    return { item: await this.defs.save(item) };
  }

  async remove(id: string): Promise<{ ok: true }> {
    const res = await this.defs.delete({ id });
    if (!res.affected) throw new NotFoundException('物品不存在');
    return { ok: true };
  }
}
