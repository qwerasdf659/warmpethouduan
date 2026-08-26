import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HomeLayout } from '../entities/home-layout.entity';
import { PetEquip } from '../entities/pet-equip.entity';

/**
 * 物品离手时把它从「穿戴」与「摆放」里摘掉。
 *
 * 为什么需要：`pet_equip` 与 `home_layout` 都按 `asset_code` 引用资产，
 * 它们**不会**因为实例转移或余额扣减而自动失效。不清理的话：
 *  - 卖掉的皮肤继续显示在宠物身上（买家收到一件「正在别人身上」的物品）；
 *  - 卖掉的家具继续贡献舒适度（等于卖了东西还留着收益）。
 *
 * 为什么放在 market 域而不是让 items/home 各自暴露方法：清理的**触发时机**属于
 * 交易语义（挂单、赠送、回收之后），而 items/home 不该知道市场的存在。
 * 反过来让 MarketModule 去 import ItemsModule + HomeModule 则会把宠物域整条
 * 依赖链拖进来（ItemsModule → PetModule），代价远大于在这里直接操作两张表。
 */
@Injectable()
export class HoldingCleanupService {
  constructor(
    @InjectRepository(PetEquip)
    private readonly equips: Repository<PetEquip>,
    @InjectRepository(HomeLayout)
    private readonly layouts: Repository<HomeLayout>,
  ) {}

  /**
   * 物品离手后按剩余持有量收敛穿戴与摆放。
   *
   * `remaining` 是清理后玩家仍持有的件数：唯一物品传 0 就是全部卸下，
   * 可堆叠资产传剩余件数（卖掉 3 件里的 1 件后，摆放行要收敛到 2 行）。
   */
  async settle(
    userId: string,
    assetCode: string,
    remaining: number,
  ): Promise<void> {
    if (remaining <= 0) {
      await this.equips.delete({ userId, assetCode });
    }
    const rows = await this.layouts.find({
      where: { userId, assetCode },
      order: { id: 'DESC' },
    });
    const excess = rows.slice(
      0,
      Math.max(0, rows.length - Math.max(0, remaining)),
    );
    if (excess.length > 0) {
      await this.layouts.delete({ id: In(excess.map((r) => r.id)) });
    }
  }
}
