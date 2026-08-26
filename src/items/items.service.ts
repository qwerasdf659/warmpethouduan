import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { rowsOf } from '../common/db/query-result';
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
        gridW: s.gridW ?? 1,
        gridH: s.gridH ?? 1,
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

  /**
   * 无偿发放物品（后台补偿用，不扣钱不校验价格）。
   *
   * 已下架物品也允许发放：活动限定款下架后客服仍可能需要补发。
   *
   * ⚠ 幂等只到请求级（`IdempotencyInterceptor` 的 Redis 24h 窗口）。
   * 物品发放没有 ledger 那样的天然唯一键，为它单开一张发放流水表在当前
   * 量级下不划算；与 `adjustPet` 的补偿口径一致——审计日志留痕，
   * 隔日重复提交同一 bizId 会真的再发一次。
   */
  async grant(
    userId: string,
    itemKey: string,
    qty = 1,
  ): Promise<{ itemKey: string; qty: number; granted: number }> {
    return this.lock.withLock(`pet:${userId}`, () =>
      this.grantUnlocked(userId, itemKey, qty),
    );
  }

  /**
   * 同 `grant`，但**不抢锁**：供已持有 `pet:{userId}` 锁的调用方使用
   * （扭蛋发奖、兑换的虚拟品即时到账）。
   *
   * 必须留这个入口：Redis 锁不可重入，持锁者再调 `grant` 会抢不到自己已持有的锁，
   * 重试到超时后抛 409。而这类调用往往包在 try/catch 的降级分支里，
   * 结果就是功能**静默失效**——兑换的「即时到账」一度就是这样从未生效过。
   */
  async grantUnlocked(
    userId: string,
    itemKey: string,
    qty = 1,
  ): Promise<{ itemKey: string; qty: number; granted: number }> {
    const def = await this.getDefByKey(itemKey);
    if (!def) throw new NotFoundException('物品不存在');
    const n = Math.max(1, Math.trunc(qty));
    return {
      itemKey: def.key,
      qty: await this.addOwned(userId, def.id, n),
      granted: n,
    };
  }

  /**
   * 背包加量的**唯一**写法：单语句条件 upsert。
   *
   * 与 `consumeOwned` 的条件扣减对称。不要退化成「先读 qty 再 +n 再 save」——
   * 持锁只串行化了同一玩家的主链路，后台补发、扭蛋发奖等旁路未必持同一把锁，
   * 读-改-写在那种交叠下会丢掉一次增量。
   */
  private async addOwned(
    userId: string,
    itemDefId: string,
    n: number,
  ): Promise<number> {
    const rows = rowsOf<{ qty: number }>(
      await this.owned.query(
        `INSERT INTO item_owned (user_id, item_def_id, qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_def_id)
         DO UPDATE SET qty = item_owned.qty + $3
         RETURNING qty`,
        [userId, itemDefId, n],
      ),
    );
    return Number(rows[0].qty);
  }

  /**
   * 收藏统计：按物品类型数「拥有多少种」（不是多少件）。
   *
   * 图鉴的收集条目按之推进。数**种类**而非件数，是因为同一件家具可以买多份
   * 摆满房间，按件数算的话「收集 10 种家具」用一种家具刷十次就达成了。
   */
  async ownedKindCount(userId: string): Promise<Record<string, number>> {
    const rows = await this.owned
      .createQueryBuilder('o')
      .innerJoin(ItemDef, 'd', 'd.id = o.item_def_id')
      .select('d.type', 'type')
      .addSelect('COUNT(DISTINCT o.item_def_id)', 'kinds')
      .where('o.user_id = :userId', { userId })
      // 消耗品用光后行会被删，但历史数据里可能留着 qty=0 的行，别把它算成「拥有」
      .andWhere('o.qty > 0')
      .groupBy('d.type')
      .getRawMany<{ type: string; kinds: string }>();

    const out: Record<string, number> = {};
    for (const r of rows) out[r.type] = Number(r.kinds);
    return out;
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
   *
   * `count` 用于消耗品一次买多份；收藏品传 1（买第二份没有意义，但不禁止 ——
   * 家具确实可以摆多份）。
   */
  async buy(
    userId: string,
    itemKey: string,
    bizId: string,
    count = 1,
  ): Promise<BuyResult> {
    const def = await this.getDefByKey(itemKey);
    if (!def || !def.enabled) throw new NotFoundException('物品不存在或已下架');
    if (def.price <= 0) throw new BadRequestException('该物品无需购买');
    const n = Math.max(1, Math.trunc(count));

    return this.lock.withLock(`pet:${userId}`, async () => {
      const applied = await this.economy.apply({
        userId,
        pool: def.pool,
        delta: -def.price * n,
        bizId: `buy:${bizId}`,
        reason: 'purchase',
        refId: def.key,
      });

      let qty: number;
      if (applied.duplicated) {
        // 幂等回放：扣费没真的发生，入库也不能重放，只回读当前持有量
        const cur = await this.owned.findOne({
          where: { userId, itemDefId: def.id },
        });
        qty = cur?.qty ?? 0;
      } else {
        qty = await this.addOwned(userId, def.id, n);
      }

      return {
        itemKey: def.key,
        qty,
        wallet: applied.wallet,
        duplicated: applied.duplicated,
      };
    });
  }

  /**
   * 扣减背包持有量（消耗品使用、扭蛋消耗道具等）。
   *
   * 用条件 `UPDATE ... WHERE qty >= n` 单语句原子扣减，与经济域同一思路：
   * 「先读 qty 再减」在同一玩家并发双击时会把 1 份用成 2 份。
   * 扣到 0 就删行 —— 空行没有信息量，留着还会让图鉴的「拥有种类数」把用光的
   * 消耗品算进去。
   *
   * 返回扣减后的余量；库存不足返回 null（由调用方决定报什么错）。
   */
  async consumeOwned(
    userId: string,
    itemDefId: string,
    n = 1,
  ): Promise<number | null> {
    // 必须经 rowsOf：库存不足时 UPDATE 返回 `[[], 0]`（长度为 2），
    // 直接判 `rows.length === 0` 恒为假，`rows[0].qty` 会取到 undefined
    // 并被 Number() 转成 NaN —— 调用方判 `=== null` 放行，等于不限量消耗
    const rows = rowsOf<{ qty: number }>(
      await this.owned.query(
        `UPDATE item_owned
          SET qty = qty - $3
        WHERE user_id = $1 AND item_def_id = $2 AND qty >= $3
        RETURNING qty`,
        [userId, itemDefId, n],
      ),
    );
    if (rows.length === 0) return null;
    const left = Number(rows[0].qty);
    if (left <= 0) {
      await this.owned.delete({ userId, itemDefId });
    }
    return left;
  }
}
