import type { SystemCode } from '../entities/account.entity';
import type { InstanceState } from '../entities/item-instance.entity';
import type { TxnKind } from '../entities/asset-txn.entity';

export type { SystemCode, TxnKind, InstanceState };

/**
 * 账本内置的两个货币资产 code。
 *
 * 双池「物理隔离、永不互转」不靠列名保证，而是靠「没有任何一张凭证会同时出现
 * 这两个 code 且求和为 0」—— 转移凭证按资产分组各自平衡，
 * 跨资产兑换必须显式走 `burn` + `issue`，于是不存在隐式汇率。
 */
export const GAME_COIN = 'game_coin';
export const MARKETING_POINT = 'marketing_point';

/**
 * 变动原因白名单（落 varchar，不用 pg enum：加原因不必改表结构）。
 */
export const LEDGER_REASONS = [
  // ---- 玩法产出
  'interact', // 互动照顾产出
  'offline', // 离线收益
  'race', // 赛跑奖励
  'daily', // 签到 / 每日任务
  'dex', // 图鉴解锁奖励
  'ad', // 看广告奖励
  'promo', // 兑换码核销（营销积分的唯一玩家侧入口）
  // ---- 玩法消耗
  'purchase', // 购买装扮 / 家具 / 消耗品
  'boost', // 加速 / 体力恢复
  'exchange', // 兑换中心
  'gacha', // 扭蛋抽奖花费（产出侧走 RewardService，不再产币，见 D1）
  'consume', // 使用消耗品
  'expire', // 批次过期销毁
  // ---- 后台
  'admin_grant',
  'admin_deduct',
  'compensation',
  'reversal', // 冲正
  // ---- 交易（期 2~5）
  'recycle', // 系统回收（3a）
  'gift', // 定向赠送（3b）
  'market_list', // 挂单锁定标的
  'market_unlist', // 撤单 / 超时退回
  'market_settle', // 成交分账（含手续费腿）
  'bid_freeze', // 出价冻结资金
  'bid_refund', // 被超越 / 流拍解冻
  // ---- 玩法扩展（期 6+）：均为凭空产出/消耗或玩家间转移，故都不进 BAN_EXEMPT
  'cure', // 治疗扣药/扣币（P1）
  'breed', // 繁殖扣币（P3）
  'pvp', // 异步 PvP 结算奖励（P4）
  'clinic', // 兽医接诊收益（P7）
  'fusion', // 融合凭证（P8，宠物非账本资产，记 0 金额可追溯凭证）
  'visit', // 家园访问点赞发币（P9）
  'minigame', // 小游戏结算奖励（P11）
  'event', // 限时活动奖励（P12）
  'training', // 技巧表演收益（P13）
  'trade_offer', // 双向易货冻结/成交
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

/**
 * 豁免封禁校验的原因。运营需要在封号后仍能结算补偿、追回违规收益，
 * 若一并拦死，被封账号将无法做任何账务处理。
 */
export const BAN_EXEMPT_REASONS: ReadonlySet<LedgerReason> =
  new Set<LedgerReason>([
    'admin_grant',
    'admin_deduct',
    'compensation',
    'reversal',
    'expire',
  ]);

/** 账户引用。玩家用 userId，系统账户用 systemCode。 */
export type AccountRef = { userId: string } | { systemCode: SystemCode };

/**
 * 一条分录的意图。`delta` 动可用余额，`frozenDelta` 动冻结余额。
 *
 * 允许 `delta = 0`（纯解冻结算）或 `frozenDelta = 0`（普通收支），
 * 但两者不能同时为 0 —— 那是一条没有信息量的分录（`ck_entry_nonzero`）。
 */
export interface Leg {
  account: AccountRef;
  assetCode: string;
  delta?: number;
  frozenDelta?: number;
}

/** 铸造一件唯一物品（皮肤/配饰/限定收藏品）。 */
export interface MintSpec {
  assetCode: string;
  to: AccountRef;
}

/** 转移一件唯一物品。`toState` 省略时按目标账户类型推断。 */
export interface InstanceMove {
  instanceId: string;
  from: AccountRef;
  to: AccountRef;
  toState?: InstanceState;
  /**
   * 是否重置交易冷却。省略时按「转到玩家手上就重置」推断。
   *
   * 撤单要显式传 `false`：那是把自己的东西拿回来，不该重新罚 72 小时冷却。
   * 而挂单转入 ESCROW 本就不重置 —— 否则撤单再挂单可以无限刷新冷却，冷却形同虚设。
   */
  resetCooldown?: boolean;
}

/**
 * 销毁一件唯一物品（系统回收）。
 *
 * 只有一条 `−1` 分录、没有对手方，因此实例的分录求和从 1 变成 0 —— 这是
 * 「已销毁」的定义，对账不变量 5 因此放宽为 `SUM(delta) ∈ {0, 1}`，
 * 且 `0` 必须与 `state = 'burned'` 一一对应。
 *
 * 为什么不像可堆叠资产那样直接扣数量：唯一物品没有数量，只有身份。
 * 也不能把它转给某个系统账户 —— 那会让 `ESCROW` 的持有量与「托管中的挂单数」
 * 不再相等，而后者是不变量 7 的全部内容。
 */
export interface InstanceBurn {
  instanceId: string;
  from: AccountRef;
}

/** `bizId` 的前缀域，决定幂等键的命名空间。 */
export type BizScope = 'user' | 'sys' | 'mkt';

export interface PostInput {
  kind: TxnKind;
  reason: LedgerReason;
  /** 不含前缀的业务键；`LedgerService` 内部强制加前缀 */
  bizKey: string;
  /** `scope='user'` 时必传，用于拼接 `u{userId}:` 前缀 */
  actorUserId?: string;
  scope?: BizScope;
  legs?: Leg[];
  mints?: MintSpec[];
  instanceMoves?: InstanceMove[];
  instanceBurns?: InstanceBurn[];
  refType?: string;
  refId?: string | null;
}

export interface BalanceView {
  available: number;
  frozen: number;
}

/** 本次凭证铸造出来的实例（调用方需要拿到 serial 展示「第 N/100 件」）。 */
export interface MintedInstance {
  instanceId: string;
  assetCode: string;
  serial: number | null;
}

export interface PostResult {
  txnId: string;
  bizId: string;
  /** 本次凭证涉及的账户余额（assetCode -> 余额），仅含发起方玩家账户 */
  balances: Record<string, BalanceView>;
  minted: MintedInstance[];
  /** true = 该 bizId 之前已记账，本次为幂等回放，未二次变动余额 */
  duplicated: boolean;
}

export interface EntryView {
  id: string;
  txnId: string;
  assetCode: string;
  delta: number;
  frozenDelta: number;
  balanceAfter: number;
  frozenAfter: number;
  kind: TxnKind;
  reason: string;
  bizId: string;
  refId: string | null;
  createdAt: string;
}

export function isSystemRef(
  ref: AccountRef,
): ref is { systemCode: SystemCode } {
  return 'systemCode' in ref;
}

/** 稳定的账户引用键，用于同一凭证内去重与排序前的分组。 */
export function refKey(ref: AccountRef): string {
  return isSystemRef(ref) ? `s:${ref.systemCode}` : `u:${ref.userId}`;
}
