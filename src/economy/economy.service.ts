import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import {
  GAME_COIN,
  LedgerReason,
  MARKETING_POINT,
  PostResult,
} from '../ledger/ledger.types';

/** 积分池。两池物理隔离，接口层禁止互转。 */
export type WalletPool = 'game' | 'marketing';

export interface WalletView {
  gameCoin: number;
  marketingPoint: number;
  /** 挂单/出价冻结中的部分（前端需要区分「有钱」与「能花的钱」） */
  gameCoinFrozen: number;
  marketingPointFrozen: number;
}

export interface LedgerView {
  id: string;
  /**
   * 所属凭证 id。
   *
   * 冲正是按**凭证**做的，不是按分录 —— 一张凭证可能有多条分录（买家/卖家/手续费），
   * 只冲其中一条会把守恒打破。后台的冲正入口需要这个 id。
   */
  txnId: string;
  /**
   * 资产 code。
   *
   * 重构后流水里不止两种货币 —— 道具与消耗品的变动也有分录（这正是缺口 G1 的修复：
   * 「我的皮肤没了」终于查得出来）。因此出参必须带 code，光靠 `pool` 无法区分
   * `cons_snack +3` 和 `game_coin +3`。
   */
  assetCode: string;
  /**
   * 积分池。仅对两种货币有意义；道具类分录一律落 `game`，
   * 前端应优先按 `assetCode` 展示，`pool` 只用于「快速筛两种货币」。
   */
  pool: WalletPool;
  delta: number;
  balanceAfter: number;
  bizId: string;
  reason: string;
  refId: string | null;
  createdAt: string;
}

export interface ApplyInput {
  userId: string;
  pool: WalletPool;
  /** 正数发放、负数扣减；禁止 0 */
  delta: number;
  /** 幂等键（客户端 UUID 或服务端拼的稳定串） */
  bizId: string;
  reason: LedgerReason;
  refId?: string | null;
  /** 服务端派生的键（定时任务、后台批量）传 false，跳过 `u{userId}:` 前缀 */
  actorIsPlayer?: boolean;
}

export interface ApplyResult {
  wallet: WalletView;
  entry: Pick<LedgerView, 'pool' | 'delta' | 'balanceAfter' | 'bizId'> & {
    txnId: string;
  };
  /** true = 该 bizId 之前已记账，本次为幂等回放，未二次变动余额 */
  duplicated: boolean;
}

/** 池 → 资产 code。双池在新模型里是两个 `asset_def` 行，而不是两列。 */
export const POOL_ASSET: Record<WalletPool, string> = {
  game: GAME_COIN,
  marketing: MARKETING_POINT,
};

/**
 * 货币视角的账本门面。
 *
 * 账本本身是行式统一的（货币 / 可堆叠道具 / 唯一实例同一套凭证与分录），但
 * 大量存量接口的出参是 `{ gameCoin, marketingPoint }` 这个形状，客户端也按它渲染。
 * 与其让十几个玩法各自去拼 `balances()['game_coin'].available`，不如在这里收口一次。
 *
 * 本类**不含任何记账逻辑**——它只做「池 ↔ 资产 code」和「余额 map ↔ WalletView」
 * 两次翻译，实际写入一律委托 `LedgerService`。需要一次动多种资产（扣币 + 发道具）
 * 的场景不要用它，用 `RewardService.exchange`。
 */
@Injectable()
export class EconomyService {
  private readonly logger = new Logger('Economy');

  constructor(private readonly ledger: LedgerService) {}

  /** 读钱包（无账户时按 0 返回，不产生写）。 */
  async getWallet(userId: string): Promise<WalletView> {
    const balances = await this.ledger.balances(userId);
    return {
      gameCoin: balances[GAME_COIN]?.available ?? 0,
      marketingPoint: balances[MARKETING_POINT]?.available ?? 0,
      gameCoinFrozen: balances[GAME_COIN]?.frozen ?? 0,
      marketingPointFrozen: balances[MARKETING_POINT]?.frozen ?? 0,
    };
  }

  /**
   * 记一笔货币账。同一 bizId 重复调用只生效一次。
   *
   * 单次调用只动一个池。需要同时动两池、或同时动货币与道具的场景，
   * 走 `RewardService.exchange`（一张凭证多条分录，真原子），
   * **不要**连调两次本方法——那不是原子的。
   */
  async apply(input: ApplyInput): Promise<ApplyResult> {
    const assetCode = POOL_ASSET[input.pool];
    if (!assetCode) throw new BadRequestException('未知积分池');
    if (!Number.isSafeInteger(input.delta) || input.delta === 0) {
      throw new BadRequestException('delta 必须为非零安全整数');
    }

    const isPlayer = input.actorIsPlayer ?? true;
    const result = await this.ledger.post({
      kind: input.delta > 0 ? 'issue' : 'burn',
      reason: input.reason,
      bizKey: input.bizId,
      actorUserId: input.userId,
      scope: isPlayer ? 'user' : 'sys',
      legs: [
        {
          account: { userId: input.userId },
          assetCode,
          delta: input.delta,
        },
      ],
      refId: input.refId ?? null,
    });

    return this.toApplyResult(input, result);
  }

  /** 玩家流水分页（倒序）。可按池或具体资产筛选。 */
  async listLedger(
    userId: string,
    opts: {
      page: number;
      pageSize: number;
      pool?: WalletPool;
      assetCode?: string;
    },
  ): Promise<{ list: LedgerView[]; total: number }> {
    const { list, total } = await this.ledger.history(userId, {
      page: opts.page,
      pageSize: opts.pageSize,
      assetCode: this.resolveAssetFilter(opts),
    });
    return { list: list.map((e) => this.toLedgerView(e)), total };
  }

  /** 后台全局流水分页（倒序）。可按玩家 / 池 / 资产 / 原因筛选。 */
  async listGlobalLedger(opts: {
    page: number;
    pageSize: number;
    userId?: string;
    pool?: WalletPool;
    assetCode?: string;
    reason?: string;
  }): Promise<{
    list: (LedgerView & { userId: string | null })[];
    total: number;
  }> {
    const { list, total } = await this.ledger.globalHistory({
      page: opts.page,
      pageSize: opts.pageSize,
      userId: opts.userId,
      assetCode: this.resolveAssetFilter(opts),
      reason: opts.reason,
    });
    return {
      list: list.map((e) => ({ ...this.toLedgerView(e), userId: e.userId })),
      total,
    };
  }

  /**
   * 后台人工发币/扣币。走同一记账入口，因此天然带幂等与余额非负校验。
   *
   * `actorIsPlayer: false`：后台的 bizId 由运营填写或批量派生，不该被冠上
   * 某个玩家的前缀——否则同一个运营批次针对不同玩家会拼出不同的键，
   * 重试整批时无法幂等。
   */
  async adminGrant(input: {
    userId: string;
    pool: WalletPool;
    delta: number;
    bizId: string;
    refId?: string | null;
  }): Promise<ApplyResult> {
    // 后台人工改余额是绕过所有玩法规则的直接发放/扣减，必须留痕
    this.logger.log(
      `后台人工${input.delta >= 0 ? '发放' : '扣减'} user=${input.userId} pool=${input.pool} delta=${input.delta} biz=${input.bizId}`,
    );
    return this.apply({
      userId: input.userId,
      pool: input.pool,
      delta: input.delta,
      bizId: `admin:${input.bizId}:${input.userId}`,
      reason: input.delta >= 0 ? 'admin_grant' : 'admin_deduct',
      refId: input.refId ?? null,
      actorIsPlayer: false,
    });
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 把「池」与「资产 code」两种筛选收敛成一个 assetCode。
   *
   * 两者同时给时 `assetCode` 胜出：它更精确，而 `pool` 只是「快速筛两种货币」的
   * 便捷入口。反过来让 `pool` 覆盖 `assetCode` 会让「查某件皮肤的流水」静默变成
   * 「查游戏币的流水」—— 筛选被悄悄改掉比报错难查得多。
   */
  private resolveAssetFilter(opts: {
    pool?: WalletPool;
    assetCode?: string;
  }): string | undefined {
    if (opts.assetCode) return opts.assetCode;
    return opts.pool ? POOL_ASSET[opts.pool] : undefined;
  }

  private async toApplyResult(
    input: ApplyInput,
    result: PostResult,
  ): Promise<ApplyResult> {
    // 重读整个钱包而不是只用 result.balances 里变动的那一项：出参形状要求两池齐全，
    // 而本次凭证只碰了一池，另一池的值仍需查库
    const wallet = await this.getWallet(input.userId);
    return {
      wallet,
      entry: {
        txnId: result.txnId,
        pool: input.pool,
        delta: input.delta,
        balanceAfter:
          input.pool === 'game' ? wallet.gameCoin : wallet.marketingPoint,
        bizId: result.bizId,
      },
      duplicated: result.duplicated,
    };
  }

  private toLedgerView(e: {
    id: string;
    txnId: string;
    assetCode: string;
    delta: number;
    balanceAfter: number;
    bizId: string;
    reason: string;
    refId: string | null;
    createdAt: string;
  }): LedgerView {
    return {
      id: e.id,
      txnId: e.txnId,
      assetCode: e.assetCode,
      pool: e.assetCode === MARKETING_POINT ? 'marketing' : 'game',
      delta: e.delta,
      balanceAfter: e.balanceAfter,
      bizId: e.bizId,
      reason: e.reason,
      refId: e.refId,
      createdAt: e.createdAt,
    };
  }
}
