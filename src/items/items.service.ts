import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { ItemDef } from '../entities/item-def.entity';
import { ItemOwned } from '../entities/item-owned.entity';
import { SEED_ITEMS } from './item-seed';

export interface ItemDefView {
  key: string;
  type: string;
  name: string;
  slot: string | null;
  price: number;
  pool: string;
  comfort: number;
  meta: Record<string, unknown>;
  sortOrder: number;
}

export interface BuyResult {
  itemKey: string;
  qty: number;
  wallet: WalletView;
  duplicated: boolean;
}

/**
 * 物品域公共服务：物品定义读取、背包持有、购买（唯一扣费入口）。
 * 换装（wardrobe）与家园（home）共用本服务的购买逻辑，避免重复实现扣费/入库。
 * 启动时幂等播种初始 item_def。
 */
@Injectable()
export class ItemsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Items');

  constructor(
    @InjectRepository(ItemDef)
    private readonly defs: Repository<ItemDef>,
    @InjectRepository(ItemOwned)
    private readonly owned: Repository<ItemOwned>,
    private readonly economy: EconomyService,
    private readonly lock: LockService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.lock.withLock('item:bootstrap', () => this.seed(), {
        ttlMs: 30_000,
        retries: 3,
        retryDelayMs: 500,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`物品播种跳过/失败（已忽略）: ${msg}`);
    }
  }

  private async seed(): Promise<void> {
    const existing = await this.defs.find({ select: { key: true } });
    const known = new Set(existing.map((d) => d.key));
    const toInsert = SEED_ITEMS.filter((s) => !known.has(s.key)).map((s) =>
      this.defs.create({
        key: s.key,
        type: s.type,
        name: s.name,
        slot: s.slot,
        price: s.price,
        pool: s.pool,
        comfort: s.comfort,
        meta: s.meta ?? {},
        enabled: true,
        sortOrder: s.sortOrder,
      }),
    );
    if (toInsert.length > 0) {
      await this.defs.save(toInsert);
      this.logger.log(`播种物品定义 +${toInsert.length}`);
    }
  }

  // ---------------------------------------------------------------- 读

  async listDefsByType(types: string[]): Promise<ItemDef[]> {
    return this.defs.find({
      where: types.map((type) => ({
        type: type as ItemDef['type'],
        enabled: true,
      })),
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  async getDefByKey(key: string): Promise<ItemDef | null> {
    return this.defs.findOne({ where: { key } });
  }

  /** 玩家背包：itemDefId -> qty。 */
  async ownedMap(userId: string): Promise<Map<string, number>> {
    const rows = await this.owned.find({ where: { userId } });
    return new Map(rows.map((r) => [r.itemDefId, r.qty]));
  }

  toDefView(d: ItemDef): ItemDefView {
    return {
      key: d.key,
      type: d.type,
      name: d.name,
      slot: d.slot,
      price: d.price,
      pool: d.pool,
      comfort: d.comfort,
      meta: d.meta,
      sortOrder: d.sortOrder,
    };
  }

  // ---------------------------------------------------------------- 写

  /**
   * 购买物品：扣费（EconomyService.apply，(userId,bizId,pool) 持久幂等）+ 入库。
   * 幂等回放（duplicated）时不重复入库，保证按 bizId 幂等。
   */
  async buy(
    userId: string,
    itemKey: string,
    bizId: string,
  ): Promise<BuyResult> {
    const def = await this.getDefByKey(itemKey);
    if (!def || !def.enabled) throw new NotFoundException('物品不存在或已下架');
    if (def.price <= 0) throw new BadRequestException('该物品无需购买');

    return this.lock.withLock(`pet:${userId}`, async () => {
      const applied = await this.economy.apply({
        userId,
        pool: def.pool,
        delta: -def.price,
        bizId: `buy:${bizId}`,
        reason: 'purchase',
        refId: def.key,
      });

      let qty: number;
      if (applied.duplicated) {
        // 已处理过：只回读当前持有量，不重复入库
        const cur = await this.owned.findOne({
          where: { userId, itemDefId: def.id },
        });
        qty = cur?.qty ?? 0;
      } else {
        const cur = await this.owned.findOne({
          where: { userId, itemDefId: def.id },
        });
        if (cur) {
          cur.qty += 1;
          qty = (await this.owned.save(cur)).qty;
        } else {
          qty = (
            await this.owned.save(
              this.owned.create({ userId, itemDefId: def.id, qty: 1 }),
            )
          ).qty;
        }
      }

      return {
        itemKey: def.key,
        qty,
        wallet: applied.wallet,
        duplicated: applied.duplicated,
      };
    });
  }
}
