import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { comfortFactorOf } from '../pet/pet.config';
import { ItemDef } from '../entities/item-def.entity';
import { HomeLayout } from '../entities/home-layout.entity';
import { HomeStat } from '../entities/home-stat.entity';
import { ItemsService } from '../items/items.service';

const HOME_TYPES = ['furniture'];

export interface PlacedView {
  layoutId: string;
  itemKey: string;
  name: string;
  comfort: number;
  posX: number;
  posY: number;
}

export interface HomeView {
  comfort: number;
  comfortFactor: number;
  items: {
    key: string;
    name: string;
    price: number;
    pool: string;
    comfort: number;
    owned: number;
    placed: number;
  }[];
  placed: PlacedView[];
}

/**
 * 家园：家具购买（走 ItemsService）+ 摆放/收纳。摆放增量维护 home_stat.comfort，
 * comfort 决定宠物心情衰减减免 comfortFactor（供 PetService 读取）。
 */
@Injectable()
export class HomeService {
  constructor(
    @InjectRepository(HomeLayout)
    private readonly layouts: Repository<HomeLayout>,
    @InjectRepository(HomeStat)
    private readonly stats: Repository<HomeStat>,
    @InjectRepository(ItemDef)
    private readonly defs: Repository<ItemDef>,
    private readonly items: ItemsService,
    private readonly lock: LockService,
    private readonly config: GameConfigService,
  ) {}

  async getHome(userId: string): Promise<HomeView> {
    const defs = await this.items.listDefsByType(HOME_TYPES);
    const ownedIds = await this.items.ownedMap(userId);
    const layouts = await this.layouts.find({
      where: { userId },
      order: { id: 'ASC' },
    });
    const comfort = await this.readComfort(userId);

    const placedCount = new Map<string, number>();
    for (const l of layouts) {
      placedCount.set(l.itemDefId, (placedCount.get(l.itemDefId) ?? 0) + 1);
    }
    const idToDef = new Map(defs.map((d) => [d.id, d]));
    // 摆放里可能包含已下架家具，补查一次
    const missingIds = layouts
      .map((l) => l.itemDefId)
      .filter((id) => !idToDef.has(id));
    if (missingIds.length > 0) {
      const extra = await this.defs.find({ where: { id: In(missingIds) } });
      for (const d of extra) idToDef.set(d.id, d);
    }

    return {
      comfort,
      comfortFactor: comfortFactorOf(
        comfort,
        await this.config.get('pet.comfort'),
      ),
      items: defs.map((d) => ({
        key: d.key,
        name: d.name,
        price: d.price,
        pool: d.pool,
        comfort: d.comfort,
        owned: ownedIds.get(d.id) ?? 0,
        placed: placedCount.get(d.id) ?? 0,
      })),
      placed: layouts.map((l) => {
        const d = idToDef.get(l.itemDefId);
        return {
          layoutId: l.id,
          itemKey: d?.key ?? '',
          name: d?.name ?? '',
          comfort: d?.comfort ?? 0,
          posX: l.posX,
          posY: l.posY,
        };
      }),
    };
  }

  /** 购买家具（仅限 furniture 类型）。 */
  async buy(userId: string, itemKey: string, bizId: string) {
    const def = await this.items.getDefByKey(itemKey);
    if (!def || def.type !== 'furniture') {
      throw new BadRequestException('该物品不是家具');
    }
    return this.items.buy(userId, itemKey, bizId);
  }

  /** 摆放一件家具（受背包 qty 约束），并累加舒适度。 */
  async place(
    userId: string,
    itemKey: string,
    posX = 0,
    posY = 0,
  ): Promise<HomeView> {
    const def = await this.items.getDefByKey(itemKey);
    if (!def || def.type !== 'furniture') {
      throw new BadRequestException('该物品不是家具');
    }

    return this.lock.withLock(`pet:${userId}`, async () => {
      const ownedMap = await this.items.ownedMap(userId);
      const ownedQty = ownedMap.get(def.id) ?? 0;
      const placedQty = await this.layouts.count({
        where: { userId, itemDefId: def.id },
      });
      if (placedQty >= ownedQty) {
        throw new BadRequestException('可摆放数量不足，请先购买');
      }

      await this.layouts.save(
        this.layouts.create({ userId, itemDefId: def.id, posX, posY }),
      );
      await this.addComfort(userId, def.comfort);
      return this.getHome(userId);
    });
  }

  /** 收纳一件家具，扣减舒适度。 */
  async remove(userId: string, layoutId: string): Promise<HomeView> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      const row = await this.layouts.findOne({
        where: { id: layoutId, userId },
      });
      if (!row) throw new NotFoundException('摆放记录不存在');
      const def = await this.defs.findOne({ where: { id: row.itemDefId } });
      await this.layouts.delete({ id: row.id });
      await this.addComfort(userId, -(def?.comfort ?? 0));
      return this.getHome(userId);
    });
  }

  // ---------------------------------------------------------------- 内部

  private async readComfort(userId: string): Promise<number> {
    const stat = await this.stats.findOne({ where: { userId } });
    return stat?.comfort ?? 0;
  }

  /** 增量维护 home_stat.comfort（不存在则建行），下限 0。 */
  private async addComfort(userId: string, delta: number): Promise<void> {
    let stat = await this.stats.findOne({ where: { userId } });
    if (!stat) {
      stat = this.stats.create({ userId, comfort: 0 });
    }
    stat.comfort = Math.max(0, stat.comfort + delta);
    await this.stats.save(stat);
  }
}
