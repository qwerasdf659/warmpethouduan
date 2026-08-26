import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { GachaDraw, GachaPrize } from '../entities/gacha-draw.entity';
import { GachaState } from '../entities/gacha-state.entity';
import { ItemsService } from '../items/items.service';
import {
  GachaEntry,
  GachaPool,
  getGachaPool,
  pickEntry,
  pickRareEntry,
  probabilityTable,
} from './gacha.config';

/** 抽到重复品时按币折算的收藏品类型（家具可摆多份，不算重复）。 */
const DUPE_TYPES = new Set(['skin', 'accessory']);

export interface GachaPoolView {
  key: string;
  name: string;
  pool: string;
  cost: number;
  costTen: number;
  pity: number;
  dupeCoin: number;
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
 * 三个必须保证的性质：
 *  1. **重试不重掷**：结果落 `gacha_draw`，`(user_id, biz_id)` 唯一，重复提交回放；
 *  2. **保底可靠**：计数落 `gacha_state`（不放 Redis，理由见实体注释）；
 *  3. **概率可公示**：权重换算的百分比由 `GET /gacha` 直接给出，
 *     前端展示的就是服务端实际使用的那份权重，不存在两份口径。
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
    private readonly items: ItemsService,
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
        dupeCoin: p.dupeCoin,
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
        // 上次掷出来了但没发到手（发货中途崩了）：照原样补发，绝不重掷
        if (!replay.delivered) await this.deliver(replay, pool);
        return this.resultOf(userId, replay, true);
      }

      const cost = times === 10 ? pool.costTen : pool.cost;
      await this.economy.apply({
        userId,
        pool: pool.pool,
        delta: -cost,
        bizId: `gacha:${bizId}`,
        reason: 'gacha',
        refId: pool.key,
      });

      const state = await this.loadState(userId, poolKey);
      const rolled = this.rollAll(pool, times, state);

      // 先把「掷出了什么」落库（delivered=false），再发货。
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
   * 这里就地把「重复的外观类」折算成币：外观第二份对玩家零价值，
   * 「抽了半天全是重复」是抽奖体验最容易崩的地方。家具不折算（可以摆多份）。
   *
   * 判定用「本次抽奖前是否已拥有」并把本轮已计入的也算上：
   * 十连里抽到两个同款皮肤，第二个也该折币，否则背包会出现 qty=2 的皮肤。
   */
  private async plan(
    userId: string,
    pool: GachaPool,
    entries: GachaEntry[],
  ): Promise<GachaPrize[]> {
    const ownedIds = await this.items.ownedMap(userId);
    const plannedThisRound = new Set<string>();
    const prizes: GachaPrize[] = [];

    for (const e of entries) {
      if (e.kind === 'coin') {
        prizes.push(this.toPrize(e, e.amount, false));
        continue;
      }

      const def = e.itemKey ? await this.items.getDefByKey(e.itemKey) : null;
      if (!def) {
        // 配置指向了不存在的物品：折成币而不是让玩家白花钱（软失败不死亡）
        this.logger.warn(
          `扭蛋档位 ${e.key} 指向的物品 ${e.itemKey ?? '(空)'} 不存在，已折算为币`,
        );
        prizes.push(this.toPrize(e, pool.dupeCoin, true));
        continue;
      }

      const isDupe =
        DUPE_TYPES.has(def.type) &&
        (ownedIds.has(def.id) || plannedThisRound.has(def.id));
      if (isDupe && pool.dupeCoin > 0) {
        prizes.push(this.toPrize(e, pool.dupeCoin, true));
        continue;
      }

      plannedThisRound.add(def.id);
      prizes.push(this.toPrize(e, 0, false));
    }
    return prizes;
  }

  /**
   * 兑现已落库的产出清单，然后打上 `delivered`。
   *
   * 币入账幂等（bizId 由抽奖的 bizId 派生，靠流水唯一约束兜住），
   * 物品补发则**可能重复**：`item_owned` 没有按业务键的幂等位。
   * 这是有意的取舍 —— 崩在发货中途时，宁可多给一件消耗品，
   * 也不要为了严格一次性而去重掷（重掷才是能被反复利用的漏洞）。
   */
  private async deliver(row: GachaDraw, pool: GachaPool): Promise<void> {
    let coinTotal = 0;
    for (const p of row.prizes) {
      if (p.kind === 'coin') {
        coinTotal += p.amount;
        continue;
      }
      // 必须走 grantUnlocked：本方法在 `pet:{userId}` 锁内，Redis 锁不可重入
      if (p.itemKey) {
        await this.items.grantUnlocked(row.userId, p.itemKey, p.qty);
      }
    }

    if (coinTotal > 0) {
      // 整轮的币合成一笔入账：十连产生十条流水会把玩家的流水页刷满，
      // 且对账时看不出它们属于同一次抽奖
      await this.economy.apply({
        userId: row.userId,
        pool: pool.pool,
        delta: coinTotal,
        bizId: `gacha-payout:${row.bizId}`,
        reason: 'gacha',
        refId: pool.key,
      });
    }

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
      // 发币后余额已变，重读一次而不是用扣费时的快照
      wallet: await this.economy.getWallet(userId),
      pity: st?.pity ?? 0,
      duplicated,
    };
  }

  private toPrize(
    e: GachaEntry,
    amount: number,
    converted: boolean,
  ): GachaPrize {
    return {
      entryKey: e.key,
      name: e.name,
      kind: converted ? 'coin' : e.kind,
      amount: e.kind === 'coin' || converted ? amount : 0,
      itemKey: converted ? null : e.itemKey,
      qty: converted ? 0 : e.qty,
      rare: e.rare,
      converted,
    };
  }
}
