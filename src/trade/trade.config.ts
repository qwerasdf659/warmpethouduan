/**
 * 双向易货（barter）可调数值。
 *
 * 本域受 `market.enabled` 总闸 + `market.features.trade` 分档开关约束（进场类操作），
 * 退出类（撤销/拒绝/超时）不受约束——理由与市场一致：关闸是为了止血，
 * 不是把已冻结的资产锁死。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface TradeRules {
  /** 报价有效期小时数（到期自动取消并解冻） */
  expireHours: number;
  /** 单个报价单每一侧最多摆放的物品项数 */
  maxItemsPerSide: number;
}

export interface TradeValuationBand {
  /** 是否启用两侧估值对等校验 */
  enabled: boolean;
  /**
   * 两侧估值允许的最大倍差。`max(A,B) / min(A,B) > maxRatio` 即拒绝建单。
   *
   * 3 倍是权衡的结果：易货本就该允许「我更想要你这件」的溢价，卡太死会让
   * 正常换装交易频繁被拒；但 10 倍以上的悬殊组合基本只有一种解释——
   * 对价在站外用真钱付了，站内这单只是交割动作。
   */
  maxRatio: number;
}

export const TRADE_CONFIG = {
  'trade.rules': defineConfig<TradeRules>({
    description:
      '双向易货：报价有效期与单侧最大物品项数。到期自动取消并双向解冻',
    default: { expireHours: 24, maxItemsPerSide: 6 },
    schema: strictObject({
      expireHours: posInt.max(8760).required(),
      maxItemsPerSide: posInt.max(50).required(),
    }),
  }),

  'trade.valuationBand': defineConfig<TradeValuationBand>({
    description:
      '双向易货的两侧估值对等校验（易货没有单价，这是它的限价等价物）。两侧按参考价估值，倍差超过 maxRatio 即拒绝建单',
    default: { enabled: true, maxRatio: 3 },
    schema: strictObject({
      enabled: Joi.boolean().required(),
      maxRatio: Joi.number().min(1).max(1000).required(),
    }),
  }),
};

export type TradeConfigShape = ShapeOf<typeof TRADE_CONFIG>;
