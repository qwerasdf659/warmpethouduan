/**
 * 交易市场配置。
 *
 * 这里的每一项都是**出事时能立刻拧的旋钮**，这是它们放配置中心而不是写死在代码里
 * 的唯一理由：交易一旦出问题（刷币外挂、站外币商、定价配错），处置窗口是分钟级的，
 * 而发版是小时级的。
 *
 * `market.enabled` 是总闸（风控清单 R10）：关掉它之后**建仓类**写操作立刻拒绝
 * （回收 / 赠送 / 挂单 / 出价 / 一价成交），已挂的单不会消失、已冻结的资产不会丢。
 *
 * ⚠ **平仓类操作刻意不受总闸约束**，别把它们"补齐"成也要校验：
 * 玩家撤单（`MarketService.cancel`）、后台强制撤单、到期退回、竞价结算走的都是
 * `TradeSettlementService.unwind`，总闸关闭时依然可用。理由是关市场的典型场景就是
 * 「出事了先止血」，此时标的还在 ESCROW、买家的钱还在冻结里 —— 若连退出通道一起关掉，
 * 玩家资产就被永久锁死，而这比让市场多开几分钟严重得多。
 * 换句话说总闸的语义是"不许再进场"，不是"冻住所有人"。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

/**
 * 分档开关：每条玩家间流转路径一个独立可关的开关。
 *
 * 粒度做到「每条路径一个」而不是一个总开关，是因为出事时要能只关掉出问题的那条
 * （比如易货被刷就只关易货），而不是把整个市场一起停掉。
 */
export interface MarketFeatures {
  /** 3a 系统回收 */
  recycle: boolean;
  /** 3b 定向赠送 */
  gift: boolean;
  /** 3c 一价寄售 */
  listing: boolean;
  /** 3d 自由竞价 */
  auction: boolean;
  /** 3e 双向易货（barter） */
  trade: boolean;
}

export interface MarketRisk {
  /** R1：注册满多少天才可交易（防注册即洗号） */
  minAccountAgeDays: number;
  /** R3：单日交易笔数上限 */
  maxTradesPerDay: number;
  /** R3：单日交易额上限（按计价资产） */
  maxValuePerDay: number;
  /**
   * R5：异常价格告警倍率。
   *
   * 挂单价与参考价（商店价）之比超出 `[1/ratio, ratio]` 就打告警日志。
   * 只告警不拦截 —— 拦截由下面的 `priceBand` 负责，两者阈值不同：
   * 告警要宽松（宁可多看几条），拦截要严格（拦错就是玩家挂不上单）。
   */
  abnormalPriceRatio: number;
}

export interface MarketPriceBand {
  /** R6：是否启用平台限价 */
  enabled: boolean;
  /** 下限 = 参考价 × minRatio（万分比） */
  minBps: number;
  /** 上限 = 参考价 × maxBps / 10000 */
  maxBps: number;
}

const DEFAULT_FEATURES: MarketFeatures = {
  // 按期逐个打开。默认全关是刻意的：迁移落库之后市场代码就在线上了，
  // 但「代码就位」不等于「可以开门做生意」——风控阈值、手续费率、限价区间
  // 都要运营先定。全关状态下市场接口一律 403，不存在「忘了关」的窗口。
  recycle: false,
  gift: false,
  listing: false,
  auction: false,
  trade: false,
};

/**
 * D12 定值（2026-08-27）。
 *
 * `maxValuePerDay` 必须与限价上限**联动**：限量款商店价 5000、限价上限 10 倍 ⇒
 * 单件合法成交价可达 50000。若日额度也是 50000，玩家买一件顶价收藏品就锁死当天，
 * 而这是完全正常的交易行为 —— 额度本该拦工作室，不该拦收藏玩家。取 100000
 * （约两件顶价限量款，或 100 件普通消耗品）。
 *
 * 对工作室的实际约束靠另外三道，而不是靠把额度压到伤及正常玩家：
 * R1 新号 7 天冷却（抬高养号成本）、单日 20 笔（笔数比金额更能刻画批量搬运）、
 * R4 净流出日报（跨天观察单向流动）。
 */
const DEFAULT_RISK: MarketRisk = {
  minAccountAgeDays: 7,
  maxTradesPerDay: 20,
  maxValuePerDay: 100_000,
  // 限价上限放宽到 10 倍之后，5 倍告警会把合法的收藏品溢价大量报进来，
  // 告警一多就没人看了。抬到 8 倍，仍远低于「天价挂单」的量级
  abnormalPriceRatio: 8,
};

/**
 * D5 定值（2026-08-27）：启用限价，区间 50% ~ 1000% 商店价。
 *
 * **下限 50%（不是 30%）**。下限是站外私下交易的主要摩擦源：站外交易的形态是
 * 「B 站外付真钱给 A，A 在站内用极低价把物品交割给 B」，所以他们要的是**尽可能低**
 * 的挂单价 —— 下限越高，B 越得真的掏币，这条通道越不划算。
 * 30% 恰好等于系统回收率，意味着「挂到最低价」与「卖给系统」等价，市场毫无意义；
 * 抬到 50% 既高于回收价（市场才有存在价值），又给正常的折价快出留了空间。
 *
 * **上限 1000%（不是 300%）**。限量编号的收藏溢价是 D3 的既定玩法，
 * 「第 1/100 件」卖到商店价的数倍是这套玩法的全部意义，300% 会直接压死它。
 * 上限的目标从来不是控价，而是拦住「天价挂单当洗钱标记/刷成交额」——
 * 那类价格通常是几个数量级的偏离，10 倍足够拦住。
 */
const DEFAULT_PRICE_BAND: MarketPriceBand = {
  enabled: true,
  minBps: 5_000,
  maxBps: 100_000,
};

export const MARKET_CONFIG = {
  'market.enabled': defineConfig<boolean>({
    description:
      '交易市场总开关（R10）。关闭后所有市场写操作立刻拒绝，已挂单与已冻结资产不受影响，仍可撤单/结算',
    default: false,
    schema: Joi.boolean().required(),
  }),

  'market.features': defineConfig<MarketFeatures>({
    description:
      '交易分档开关：recycle=系统回收(3a)、gift=定向赠送(3b)、listing=一价寄售(3c)、auction=自由竞价(3d)、trade=双向易货(3e)',
    default: DEFAULT_FEATURES,
    schema: strictObject({
      recycle: Joi.boolean().required(),
      gift: Joi.boolean().required(),
      listing: Joi.boolean().required(),
      auction: Joi.boolean().required(),
      trade: Joi.boolean().required(),
    }),
  }),

  /**
   * D4 定值（2026-08-27）：固定 500 bps（5%），**不做阶梯**。
   *
   * 5% 与 Steam 市场、暴雪拍卖场同量级，玩家对这个数字有预期。不做「按资产分档」
   * 或「按等级优惠」是因为：阶梯的收益是微调通胀回收速度，代价是每笔成交都要解释
   * 「为什么这次收的和上次不一样」，而 `fee_bps` 已落挂单快照、历史成交口径不受
   * 改率影响 —— 真要调，直接改这个数就行，不需要先有阶梯结构。
   */
  'market.feeBps': defineConfig<number>({
    description:
      '成交手续费率（万分比）。手续费进 FEE 账户即退出流通，是通胀 sink（R9）。改率不影响历史成交——挂单时已落 fee_bps 快照',
    default: 500,
    schema: nonNegInt.max(10_000).required(),
  }),

  'market.listingHours': defineConfig<number>({
    description: '挂单有效期（小时）。到期自动退回标的，不占用玩家资产',
    default: 72,
    schema: posInt.max(24 * 30).required(),
  }),

  'market.recycleRateBps': defineConfig<number>({
    description:
      '系统回收价率（万分比，相对商店价）。刻意低于 10000：回收是 sink 而非套利通道，买入再回收必须亏',
    default: 3_000,
    schema: nonNegInt.max(9_000).required(),
  }),

  'market.risk': defineConfig<MarketRisk>({
    description:
      '交易风控阈值：R1 新号冷却天数、R3 单日笔数与金额上限、R5 异常价格告警倍率',
    default: DEFAULT_RISK,
    schema: strictObject({
      minAccountAgeDays: nonNegInt.max(365).required(),
      maxTradesPerDay: posInt.max(10_000).required(),
      maxValuePerDay: posInt.max(1_000_000_000).required(),
      abnormalPriceRatio: Joi.number().min(1).max(1000).required(),
    }),
  }),

  'market.priceBand': defineConfig<MarketPriceBand>({
    description:
      'R6 平台限价区间（相对商店参考价的万分比）。压缩套利空间，并堵住「1 币挂高价物」的站外交易通道',
    default: DEFAULT_PRICE_BAND,
    schema: strictObject({
      enabled: Joi.boolean().required(),
      minBps: posInt.max(100_000).required(),
      maxBps: posInt.max(1_000_000).required(),
    }),
  }),
};

export type MarketConfigShape = ShapeOf<typeof MARKET_CONFIG>;
