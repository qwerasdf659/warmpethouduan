import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HomeLayout } from '../entities/home-layout.entity';
import { ItemDef } from '../entities/item-def.entity';

/**
 * 家园舒适度的**唯一**口径：已摆放家具的 comfort 之和，实时聚合得出。
 *
 * 这里曾经是一张 `home_stat` 快照表，摆放/收纳时增量加减。它有两个必然漂移的口子：
 *  1. 后台可以直接改 `item_def.comfort`（见 AdminItemsService），而那条路径不回写快照；
 *  2. 增量维护本身是「先读后写」，与本项目其它写路径的原子性约定相悖。
 * 一旦漂移就是永久的 —— 没有任何地方会把它算回来，而玩家只会看到心情莫名衰减得快。
 *
 * 摆放数量受房间网格约束（量级在几十行），按 user_id 走 idx_home_layout_user，
 * 实时 SUM 的代价远低于维护一份会说谎的快照。
 */
@Injectable()
export class HomeComfortService {
  constructor(
    @InjectRepository(HomeLayout)
    private readonly layouts: Repository<HomeLayout>,
  ) {}

  async comfortOf(userId: string): Promise<number> {
    const row = await this.layouts
      .createQueryBuilder('l')
      .innerJoin(ItemDef, 'd', 'd.id = l.item_def_id')
      .select('COALESCE(SUM(d.comfort), 0)', 'comfort')
      .where('l.user_id = :userId', { userId })
      .getRawOne<{ comfort: string }>();
    return Number(row?.comfort ?? 0);
  }
}
