import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import {
  EconomyService,
  POOL_ASSET,
  WalletView,
} from '../economy/economy.service';
import { GachaDraw, GachaPrize } from '../entities/gacha-draw.entity';
import { GachaState } from '../entities/gacha-state.entity';
import { AssetCatalogService } from '../ledger/asset-catalog.service';
import { InventoryService } from '../ledger/inventory.service';
import { Reward, RewardService } from '../ledger/reward.service';
import {
  GachaEntry,
  GachaPool,
  getGachaPool,
  pickEntry,
  pickRareEntry,
  probabilityTable,
} from './gacha.config';

export interface GachaPoolView {
  key: string;
  name: string;
  pool: string;
  cost: number;
  costTen: number;
  pity: number;
  dupeItemKey: string | null;
  dupeQty: number;
  /** 我的保底进度（还差几抽必出稀有） */
  pityLeft: number | null;
  /** 概率公示：合规要求前端必须展示 */
  odds: { key: string; name: string; rare: boolean; percent: number }[];
}

export interface GachaDrawResult {
  poolKey: string;
  times: number;
  cost: number;
  prizes: GachaPrize[];
  wallet: WalletView;
  /** 抽完后的保底进度 */
  pity: number;
  /** true = 该 bizId 之前已抽过，本次为回放（未重掷、未再扣费） */
  duplicated: boolean;
}

/**
 * 扭蛋。经济上是**无限 sink**（见 `gacha.config.ts` 的定价口径）。
 *
 * 四个必须保证的性质：
 *  1. **重试不重掷**：结果落 `gacha_draw`，`(user_id, biz_id)` 唯一，重复提交回放；
 *  2. **保底可靠**：计数落 `gacha_state`（不放 Redis，理由见实体注释）；
 *  3. **概率可公示**：权重换算的百分比由 `GET /gacha` 直接给出，
 *     前端展示的就是服务端实际使用的那份权重，不存在两份口径；
 *  4. **不产出货币**：产出侧只有道具与消耗品（D1）。
 *
 * 扣费与发奖的关系在重构后变了：以往是「先 `economy.apply` 扣币 → 落 draw 行 →
 * 再逐个 `grantUnlocked` 发货」，三次独立写入。现在扣费与发奖合成**一张凭证**
 * （`RewardService.exchange`），因此「扣了钱没给东西」的中间态不存在。
 * `delivered` 标志仍然保留，但它守的是「掷出结果已落库、凭证尚未提交」这个更窄的窗口。
 */
@Injectable()
export class GachaService {
  private readonly logger = new Logger('Gacha');

  constructor(
    @InjectRepository(GachaDraw)
    private readonly draws: Repository<GachaDraw>,
    @InjectRepository(GachaState)
    private readonly states: Repository<GachaState>,
    private readonly economy: EconomyService,
    private readonly reward: RewardService,
    private readonly catalog: AssetCatalogService,
    private readonly inventory: InventoryService,
    private readonly config: GameConfigService,
    private readonly lock: LockService,
  ) {}

  /** 奖池列表 + 概率公示 + 我的保底进度。 */
  async list(userId: string): Promise<{
    pools: GachaPoolView[];
    wallet: WalletView;
  }> {
    const pools = await this.config.get('gacha.pools');
    const states = await this.states.find({ where: { userId } });
    const pityOf = new Map(states.map((s) => [s.poolKey, s.pity]));

    return {
      pools: pools.map((p) => ({
        key: p.key,
        name: p.name,
        pool: p.pool,
        cost: p.cost,
        costTen: p.costTen,
        pity: p.pity,
        dupeItemKey: p.dupeItemKey,
        dupeQty: p.dupeQty,
        pityLeft:
          p.pity > 0 ? Math.max(0, p.pity - (pityOf.get(p.key) ?? 0)) : null,
        odds: probabilityTable(p.entries),
      })),
      wallet: await this.economy.getWallet(userId),
    };
  }

  /** 我的抽奖记录（分页倒序）。 */
  async myDraws(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ list: GachaDraw[]; total: number }> {
    const [list, total] = await this.draws.findAndCount({
      where: { userId },
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total };
  }

  async draw(
    userId: string,
    poolKey: string,
    times: number,
    bizId: string,
  ): Promise<GachaDrawResult> {
    if (times !== 1 && times !== 10) {
      throw new BadRequestException('每次只能抽 1 次或 10 次');
    }
    const pools = await this.config.get('gacha.pools');
    const pool = getGachaPool(pools, poolKey);
    if (!pool) throw new BadRequestException('奖池不存在');

    return this.lock.withLock(`pet:${userId}`, async () => {
      // 回放要先于扣费判断：否则重试会因余额不足而报错，明明上次已经抽成功了
      const replay = await this.draws.findOne({ where: { userId, bizId } });
      if (replay) {
        // 上次掷出来了但没发到手（发货中途崩了）：照原样补发，绝不重掷。
        // 补发的凭证 bizId 与首次相同，因此这里最多命中一次幂等回放。
        if (!replay.delivered) await this.deliver(replay, pool);
        return this.resultOf(userId, replay, true);
      }

      const cost = times === 10 ? pool.costTen : pool.cost;

      /*
       * 余额预检必须在掷之前。
       *
       * 扣费与发奖现在合成一张凭证，凭证要等产出清单确定才能提交，所以真正的扣费
       * 发生在「掷出 + 落库」之后。若不预检，余额不足的玩家会留下一行
       * `delivered=false` 的抽奖记录并推进保底计数 —— 等于免费占用了一次掷出结果，
       * 之后攒够钱再用同一个 bizId 取货。预检把这条路堵在任何状态变更之前。
       *
       * 这里读到的余额是可信的：本方法持 `pet:{userId}` 锁，该玩家不会有并发花费。
       */
      const wallet = await this.economy.getWallet(userId);
      const balance =
        pool.pool === 'marketing' ? wallet.marketingPoint : wallet.gameCoin;
      if (balance < cost) throw new BadRequestException('余额不足');

      const state = await this.loadState(userId, poolKey);
      const rolled = this.rollAll(pool, times, state);

      // 先把「掷出了什么」落库（delivered=false），再兑现。
      // 顺序反过来的话，发完货但记录没落上，重试就会重新掷一次。
      const prizes = await this.plan(userId, pool, rolled.entries);
      const row = await this.draws.save(
        this.draws.create({
          userId,
          poolKey,
          bizId,
          times,
          cost,
          pool: pool.pool,
          prizes,
          delivered: false,
        }),
      );

      state.pity = rolled.pity;
      state.totalDraws += times;
      await this.states.save(state);

      await this.deliver(row, pool);
      return this.resultOf(userId, row, false);
    });
  }

  // ---------------------------------------------------------------- 内部

  private async loadState(
    userId: string,
    poolKey: string,
  ): Promise<GachaState> {
    const found = await this.states.findOne({ where: { userId, poolKey } });
    return (
      found ?? this.states.create({ userId, poolKey, pity: 0, totalDraws: 0 })
    );
  }

  /**
   * 掷出全部档位并推进保底计数。
   *
   * 保底在**每一抽**上判定（而不是十连整体）：十连里第 3 抽触发保底后，
   * 后面 7 抽应该从 0 重新累计，否则连抽会积压出「一次十连出两个稀有」的畸形分布。
   */
  private rollAll(
    pool: GachaPool,
    times: number,
    state: GachaState,
  ): { entries: GachaEntry[]; pity: number } {
    let pity = state.pity;
    const entries: GachaEntry[] = [];

    for (let i = 0; i < times; i += 1) {
      const forced =
        pool.pity > 0 && pity + 1 >= pool.pity
          ? pickRareEntry(pool.entries, Math.random)
          : null;
      const picked = forced ?? pickEntry(pool.entries, Math.random);
      entries.push(picked);
      pity = picked.rare ? 0 : pity + 1;
    }
    return { entries, pity };
  }

  /**
   * 把掷出的档位翻译成最终产出清单，**不产生任何副作用**。
   *
   * 重复品折算的口径在重构后收窄了：唯一物品实例化之后，**可交易**皮肤的第二份是
   * 有价值的资产（能挂到市场卖掉），再塞一份就是正当产出，不该折算。真正零价值的
   * 只剩「重复的、且不可交易的」那部分 —— 也就是扭蛋限定款本身。
   *
   * 判定用「本次抽奖前是否已拥有」并把本轮已计入的也算上：十连里抽到两个同款限定皮肤，
   * 第二个也该折算。
   */
  private async plan(
    userId: string,
    pool: GachaPool,
    entries: GachaEntry[],
  ): Promise<GachaPrize[]> {
    const owned = await this.inventory.ownedMap(userId);
    const plannedThisRound = new Set<string>();
    const defs = await this.catalog.getManyByCode([
      ...new Set(entries.map((e) => e.itemKey)),
    ]);
    const prizes: GachaPrize[] = [];

    for (const e of entries) {
      const def = defs.get(e.itemKey);
      if (!def) {
        // 配置指向了不存在的资产：折成补偿道具而不是让玩家白花钱（软失败不死亡）
        this.logger.warn(
          `扭蛋档位 ${e.key} 指向的资产 ${e.itemKey} 不存在，已折算为补偿道具`,
        );
        prizes.push(this.dupePrize(e, pool));
        continue;
      }

      const isDupe =
        def.kind === 'unique' &&
        !def.tradable &&
        ((owned.get(def.code) ?? 0) > 0 || plannedThisRound.has(def.code));
      if (isDupe && pool.dupeItemKey && pool.dupeQty > 0) {
        prizes.push(this.dupePrize(e, pool));
        continue;
      }

      if (def.kind === 'unique') plannedThisRound.add(def.code);
      prizes.push({
        entryKey: e.key,
        name: e.name,
        itemKey: e.itemKey,
        qty: e.qty,
        rare: e.rare,
        converted: false,
      });
    }
    return prizes;
  }

  /**
   * 兑现已落库的产出清单，然后打上 `delivered`。
   *
   * 扣费与全部产出在**一张凭证**里，因此不再需要「币入账幂等但物品可能重复」那套
   * 取舍 —— 整体幂等，整体原子。重复提交同一 bizId 会命中
   * `asset_txn.biz_id` 唯一约束并回放，不会多发一件。
   */
  private async deliver(row: GachaDraw, pool: GachaPool): Promise<void> {
    const rewards: Reward[] = row.prizes.map((p) => ({
      assetCode: p.itemKey,
      count: p.qty,
    }));

    await this.reward.exchange(
      row.userId,
      [{ assetCode: POOL_ASSET[pool.pool], count: row.cost }],
      rewards,
      {
        reason: 'gacha',
        bizKey: `gacha:draw:${row.bizId}`,
        refType: 'gacha_pool',
        refId: pool.key,
      },
    );

    row.delivered = true;
    await this.draws.update({ id: row.id }, { delivered: true });
  }

  private async resultOf(
    userId: string,
    row: GachaDraw,
    duplicated: boolean,
  ): Promise<GachaDrawResult> {
    const st = await this.states.findOne({
      where: { userId, poolKey: row.poolKey },
    });
    return {
      poolKey: row.poolKey,
      times: row.times,
      cost: row.cost,
      prizes: row.prizes,
      // 扣费后余额已变，重读一次而不是用扣费时的快照
      wallet: await this.economy.getWallet(userId),
      pity: st?.pity ?? 0,
      duplicated,
    };
  }

  private dupePrize(e: GachaEntry, pool: GachaPool): GachaPrize {
    return {
      entryKey: e.key,
      name: e.name,
      // 配置校验保证走到这里时 dupeItemKey 非空；兜底给零食免得产出为空
      itemKey: pool.dupeItemKey ?? 'cons_snack',
      qty: Math.max(1, pool.dupeQty),
      rare: e.rare,
      converted: true,
    };
  }
}
