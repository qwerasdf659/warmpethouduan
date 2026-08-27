/**
 * 广告 / 加速 / 体力恢复的可调数值。
 */
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface AdRewardConfig {
  coin: number;
  dailyCap: number;
}

export interface CostConfig {
  cost: number;
}

export interface AdTokenConfig {
  /** 凭证有效期（秒）：够放完一支激励视频 + 结算往返 */
  ttlSec: number;
  /** 每个 scene 的账号级每日签发上限（防刷） */
  dailyCapPerScene: number;
}

/**
 * 允许领取广告凭证的业务场景。**结构性**取值：每个 scene 对应一条具体的
 * 兑换代码路径，加 scene 必须同时改代码，故不开放给运营。
 */
export const AD_SCENES = [
  'ad_reward',
  'race_double',
  'race_revive',
  'breed_speedup', // P3 孵化看广告加速（每场景独立 dailyCapPerScene 配额）
] as const;
export type AdScene = (typeof AD_SCENES)[number];

// ------------------------------------------------------------------ 配置项

export const BOOST_CONFIG = {
  'boost.ad_reward': defineConfig<AdRewardConfig>({
    description: '激励视频广告奖励：每次发币量与账号级每日次数上限',
    default: { coin: 30, dailyCap: 5 },
    schema: strictObject({
      coin: nonNegInt.required(),
      dailyCap: nonNegInt.required(),
    }),
  }),

  'boost.stamina_recover': defineConfig<CostConfig>({
    description: '付费恢复满体力的游戏币花费',
    default: { cost: 50 },
    schema: strictObject({ cost: nonNegInt.required() }),
  }),

  'boost.speedup': defineConfig<CostConfig>({
    description: '清除某宠全部互动冷却的游戏币花费',
    default: { cost: 20 },
    schema: strictObject({ cost: nonNegInt.required() }),
  }),

  'boost.ad_token': defineConfig<AdTokenConfig>({
    description: '看广告凭证（nonce）：有效期与每场景每日签发上限',
    default: { ttlSec: 300, dailyCapPerScene: 10 },
    schema: strictObject({
      // TTL 必须 >0，否则凭证签发即过期；上限 1h 防误填成长期有效
      ttlSec: posInt.max(3600).required(),
      dailyCapPerScene: nonNegInt.required(),
    }),
  }),
};

export type BoostConfigShape = ShapeOf<typeof BOOST_CONFIG>;
