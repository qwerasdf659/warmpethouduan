import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import {
  GAME_COIN,
  LedgerReason,
  MARKETING_POINT,
  PostResult,
} from '../ledger/ledger.types';

/**
 * 钱包视图：两种货币的可用与冻结额。
 *
 * 这是**货币视角的窄化视图**，不是通用余额接口——通用的是
 * `LedgerService.balances()`（返回 assetCode → {available,frozen} 的全量 map）。
 * 保留这个形状是因为客户端的钱包 UI 就是两个固定的数字位；
 * 加第三种货币时应当同时改这里和 UI，而不是把它做成动态 map 让 UI 去猜。
 */
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
   * 流水里不止两种货币——道具与消耗品的变动也有分录（「我的皮肤没了」查得出来
   * 靠的就是它）。因此这是流水的**唯一**资产标识：
   * 没有第二个「积分池」字段去表达同一件事，也就不会出现
   * 「按 code 筛和按池筛结果不一致」这种只能靠读代码才能解释的现象。
   */
  assetCode: string;
  delta: number;
  balanceAfter: number;
  bizId: string;
  reason: string;
  refId: string | null;
  createdAt: string;
}

export interface ApplyInput {
  userId: string;
  /**
   * 货币资产 code（`GAME_COIN` / `MARKETING_POINT`）。
   *
   * 直接用 code 而不是「池名」：池名要多一层映射表才能落到账本，
   * 而那层映射是纯粹的翻译成本——账本、对账、流水、风控全都按 code 说话。
   */
  assetCode: string;
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
  entry: Pick<LedgerView, 'assetCode' | 'delta' | 'balanceAfter' | 'bizId'> & {
    txnId: string;
  };
  /** true = 该 bizId 之前已记账，本次为幂等回放，未二次变动余额 */
  duplicated: boolean;
}

/**
 * 货币视角的账本门面。
 *
 * 账本本身是行式统一的（货币 / 可堆叠道具 / 唯一实例同一套凭证与分录），
 * 而钱包 UI 只关心两种货币。这一层把「余额 map → WalletView」收口一次，
 * 免得十几个玩法各自去拼 `balances()['game_coin'].available`。
 *
 * 本类**不含任何记账逻辑**，实际写入一律委托 `LedgerService`。
 * 需要一次动多种资产（扣币 + 发道具）的场景不要用它，用 `RewardService.exchange`。
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
    const assetCode = input.assetCode;
    if (assetCode !== GAME_COIN && assetCode !== MARKETING_POINT) {
      // 本门面只负责货币。道具/唯一物品走 RewardService，
      // 从这里放进去会绕过 kind 校验、把件数当金额记
      throw new BadRequestException(`${assetCode} 不是货币资产`);
    }
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

  /** 玩家流水分页（倒序）。可按具体资产筛选。 */
  async listLedger(
    userId: string,
    opts: {
      page: number;
      pageSize: number;
      assetCode?: string;
    },
  ): Promise<{ list: LedgerView[]; total: number }> {
    const { list, total } = await this.ledger.history(userId, {
      page: opts.page,
      pageSize: opts.pageSize,
      assetCode: opts.assetCode,
    });
    return { list: list.map((e) => this.toLedgerView(e)), total };
  }

  /** 后台全局流水分页（倒序）。可按玩家 / 资产 / 原因筛选。 */
  async listGlobalLedger(opts: {
    page: number;
    pageSize: number;
    userId?: string;
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
      assetCode: opts.assetCode,
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
    assetCode: string;
    delta: number;
    bizId: string;
    refId?: string | null;
  }): Promise<ApplyResult> {
    // 后台人工改余额是绕过所有玩法规则的直接发放/扣减，必须留痕
    this.logger.log(
      `后台人工${input.delta >= 0 ? '发放' : '扣减'} user=${input.userId} asset=${input.assetCode} delta=${input.delta} biz=${input.bizId}`,
    );
    return this.apply({
      userId: input.userId,
      assetCode: input.assetCode,
      delta: input.delta,
      bizId: `admin:${input.bizId}:${input.userId}`,
      reason: input.delta >= 0 ? 'admin_grant' : 'admin_deduct',
      refId: input.refId ?? null,
      actorIsPlayer: false,
    });
  }

  // ---------------------------------------------------------------- 内部

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
        assetCode: input.assetCode,
        delta: input.delta,
        balanceAfter:
          input.assetCode === MARKETING_POINT
            ? wallet.marketingPoint
            : wallet.gameCoin,
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
      delta: e.delta,
      balanceAfter: e.balanceAfter,
      bizId: e.bizId,
      reason: e.reason,
      refId: e.refId,
      createdAt: e.createdAt,
    };
  }
}
