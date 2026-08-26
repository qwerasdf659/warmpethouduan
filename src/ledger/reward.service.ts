import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetCatalogService, AssetView } from './asset-catalog.service';
import { LedgerService } from './ledger.service';
import {
  BizScope,
  Leg,
  LedgerReason,
  MintSpec,
  PostResult,
  TxnKind,
} from './ledger.types';

/** 一项奖励/成本。`count` 恒为正数，方向由调用的方法决定。 */
export interface Reward {
  assetCode: string;
  count: number;
}

export interface RewardCtx {
  reason: LedgerReason;
  /** 不含前缀的业务键；前缀由 `LedgerService` 强制拼接 */
  bizKey: string;
  refType?: string;
  refId?: string | null;
  /** 默认 `user`（玩家发起）。后台/定时任务传 `sys` */
  scope?: BizScope;
}

/**
 * 所有玩法产出与消耗的**唯一出口**。
 *
 * 存在的意义是让签到 / 任务 / 赛跑 / 图鉴 / 扭蛋 / 购买 / 兑换 / 后台补发共用同一条
 * 记账路径：只有一份幂等逻辑要维护，而不是十份。旧模型下每个玩法自己拼 `bizId`、
 * 自己决定先扣钱还是先发货，于是「扣了钱没给东西」在每个玩法里都得单独防一遍。
 *
 * `exchange` 是这里最关键的方法：它把「扣费 + 发放」合成**一张凭证**，
 * 于是扭蛋、购买、兑换的原子性由单个数据库事务保证，中间失败不可能留下
 * 「钱扣了、奖品没发」的中间态。这正是旧 `EconomyService.apply` 一次只能动
 * 一个池所无法做到的。
 */
@Injectable()
export class RewardService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly catalog: AssetCatalogService,
  ) {}

  /** 发放。一次事务原子发放多种资产，`unique` 类自动铸造实例（含限量编号）。 */
  async grant(
    userId: string,
    rewards: Reward[],
    ctx: RewardCtx,
  ): Promise<PostResult> {
    return this.post(userId, [], rewards, ctx);
  }

  /** 扣费。余额不足抛 400 且**不产生任何分录**（整个事务回滚）。 */
  async charge(
    userId: string,
    costs: Reward[],
    ctx: RewardCtx,
  ): Promise<PostResult> {
    return this.post(userId, costs, [], ctx);
  }

  /** 原子「扣费 + 发放」。扭蛋 / 购买 / 兑换走这个。 */
  async exchange(
    userId: string,
    costs: Reward[],
    rewards: Reward[],
    ctx: RewardCtx,
  ): Promise<PostResult> {
    return this.post(userId, costs, rewards, ctx);
  }

  // ---------------------------------------------------------------- 内部

  private async post(
    userId: string,
    costs: Reward[],
    rewards: Reward[],
    ctx: RewardCtx,
  ): Promise<PostResult> {
    const normCosts = this.normalize(costs);
    const normRewards = this.normalize(rewards);
    if (normCosts.length === 0 && normRewards.length === 0) {
      throw new BadRequestException('奖励与成本不能同时为空');
    }

    const defs = await this.catalog.getManyByCode([
      ...normCosts.map((r) => r.assetCode),
      ...normRewards.map((r) => r.assetCode),
    ]);

    const legs: Leg[] = [];
    const mints: MintSpec[] = [];

    for (const cost of normCosts) {
      const def = this.defOf(defs, cost.assetCode);
      if (def.kind === 'unique') {
        // 唯一物品的「花掉」必须指名是哪一件，因为每件都有独立身份与编号。
        // 按 code 扣减无法回答「卖掉的是第 7/100 件还是第 92/100 件」。
        throw new BadRequestException(
          `${def.name} 是唯一物品，需通过实例转移处置，不能按数量扣减`,
        );
      }
      legs.push({
        account: { userId },
        assetCode: cost.assetCode,
        delta: -cost.count,
      });
    }

    for (const reward of normRewards) {
      const def = this.defOf(defs, reward.assetCode);
      if (def.kind === 'unique') {
        // 一件一条 mint：每件都要独立占用一个限量编号
        for (let i = 0; i < reward.count; i += 1) {
          mints.push({ assetCode: reward.assetCode, to: { userId } });
        }
      } else {
        legs.push({
          account: { userId },
          assetCode: reward.assetCode,
          delta: reward.count,
        });
      }
    }

    return this.ledger.post({
      // 混合凭证按「定义性动作」归类：有成本就是 sink（burn），纯发放是 issue。
      // 两者都不要求平衡 —— 发行与销毁本就是凭空产生与消失。
      kind: this.kindOf(normCosts.length > 0),
      reason: ctx.reason,
      bizKey: ctx.bizKey,
      actorUserId: userId,
      scope: ctx.scope ?? 'user',
      legs,
      mints,
      refType: ctx.refType,
      refId: ctx.refId ?? null,
    });
  }

  private kindOf(hasCost: boolean): TxnKind {
    return hasCost ? 'burn' : 'issue';
  }

  /** 合并同一资产的多项（十连抽到三份零食应该是一条分录，而不是三条）。 */
  private normalize(items: Reward[]): Reward[] {
    const merged = new Map<string, number>();
    for (const it of items) {
      const count = Math.trunc(it.count);
      if (count <= 0) continue;
      if (!Number.isSafeInteger(count)) {
        throw new BadRequestException('数量必须为安全整数');
      }
      merged.set(it.assetCode, (merged.get(it.assetCode) ?? 0) + count);
    }
    return [...merged].map(([assetCode, count]) => ({ assetCode, count }));
  }

  private defOf(defs: Map<string, AssetView>, code: string): AssetView {
    const def = defs.get(code);
    if (!def) throw new BadRequestException(`未知资产：${code}`);
    return def;
  }
}
