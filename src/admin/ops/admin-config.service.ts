import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameConfig } from '../../entities/game-config.entity';
import { UpsertConfigDto } from './dto/config.dto';

/** 配置中心 CRUD（KV，value 为任意 JSON）。 */
@Injectable()
export class AdminConfigService {
  constructor(
    @InjectRepository(GameConfig)
    private readonly configs: Repository<GameConfig>,
  ) {}

  async list(): Promise<{ list: GameConfig[] }> {
    return { list: await this.configs.find({ order: { key: 'ASC' } }) };
  }

  async get(key: string): Promise<GameConfig> {
    const row = await this.configs.findOne({ where: { key } });
    if (!row) throw new NotFoundException('配置项不存在');
    return row;
  }

  /** 按 key upsert。 */
  async upsert(
    key: string,
    dto: UpsertConfigDto,
  ): Promise<{ config: GameConfig }> {
    let row = await this.configs.findOne({ where: { key } });
    if (!row) {
      row = this.configs.create({
        key,
        value: dto.value,
        description: dto.description ?? '',
      });
    } else {
      row.value = dto.value;
      if (dto.description !== undefined) row.description = dto.description;
    }
    return { config: await this.configs.save(row) };
  }

  async remove(key: string): Promise<{ ok: true }> {
    const res = await this.configs.delete({ key });
    if (!res.affected) throw new NotFoundException('配置项不存在');
    return { ok: true };
  }
}
