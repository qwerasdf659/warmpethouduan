/**
 * 交易市场配置。
 *
 * 这里的每一项都是**出事时能立刻拧的旋钮**，这是它们放配置中心而不是写死在代码里
 * 的唯一理由：交易一旦出问题（刷币外挂、站外币商、定价配错），处置窗口是分钟级的，
 * 而发版是小时级的。
 *
 * `market.enabled` 是总闸（风控清单 R10）：关掉它之后所有写操作立刻拒绝，
 * 但已挂的单不会消失、已冻结的资产不会丢 —— 撤单与结算仍可由后台驱动。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

/** 分档开关。架构设计把交易分 5 期上线，每期一个独立可关的开关。 */
export interface MarketFeatures {
  /** 3a 系统回收 */
  recycle: boolean;
  /** 3b 定向赠送 */
  gift: boolean;
  /** 3c 一价寄售 */
  listing: boolean;
  /** 3d 自由竞价 */
  auction: boolean;
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
};

const DEFAULT_RISK: MarketRisk = {
  minAccountAgeDays: 7,
  maxTradesPerDay: 20,
  maxValuePerDay: 50_000,
  abnormalPriceRatio: 5,
};

const DEFAULT_PRICE_BAND: MarketPriceBand = {
  enabled: true,
  // 三折到三倍。下限防「1 币挂高价物」（那是站外私下交易的通道），
  // 上限防「天价挂单」当洗钱标记用
  minBps: 3_000,
  maxBps: 30_000,
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
      '交易分档开关：recycle=系统回收(3a)、gift=定向赠送(3b)、listing=一价寄售(3c)、auction=自由竞价(3d)',
    default: DEFAULT_FEATURES,
    schema: strictObject({
      recycle: Joi.boolean().required(),
      gift: Joi.boolean().required(),
      listing: Joi.boolean().required(),
      auction: Joi.boolean().required(),
    }),
  }),

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
