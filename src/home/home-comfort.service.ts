import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetDef } from '../entities/asset-def.entity';
import { HomeLayout } from '../entities/home-layout.entity';

/**
 * 家园舒适度的**唯一**口径：已摆放家具的 comfort 之和，实时聚合得出。
 *
 * **刻意不做快照表**。用摆放/收纳时增量加减的快照维护它，有两个必然漂移的口子：
 *  1. 后台可以直接改家具的 comfort，而那条路径不会回写快照；
 *  2. 增量维护本身是「先读后写」，与本项目其它写路径的原子性约定相悖。
 * 一旦漂移就是永久的 —— 没有任何地方会把它算回来，而玩家只会看到心情莫名衰减得快。
 *
 * 摆放数量受房间网格约束（量级在几十行），按 user_id 走 idx_home_layout_user，
 * 实时 SUM 的代价远低于维护一份会说谎的快照。
 *
 * comfort 住在 `asset_def.meta` 的 jsonb 里，因此聚合要走 `->>` 取值再转数字。
 * 缺 comfort 的家具按 0 计（COALESCE 兜底）：漏配置的后果应该是「没有加成」，
 * 而不是整个 SUM 变成 NULL 让全屋舒适度归零。
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
      .innerJoin(AssetDef, 'd', 'd.code = l.asset_code')
      .select(
        `COALESCE(SUM(COALESCE((d.meta ->> 'comfort')::int, 0)), 0)`,
        'comfort',
      )
      .where('l.user_id = :userId', { userId })
      .getRawOne<{ comfort: string }>();
    return Number(row?.comfort ?? 0);
  }
}
