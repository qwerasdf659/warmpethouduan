/**
 * 异步 PvP 天梯（P4）可调数值。
 *
 * 对手成绩由对方 opponent_snapshot 按同一套 race.formula 真实算出，**不钳制、不随机填充**
 *（区别于 race.ghost 的影子生成器，天梯钳制会让积分失去信息量）。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface PvpRank {
  /** 初始积分 */
  initialPoint: number;
  /** ELO K 系数 */
  kFactor: number;
  /** 匹配分差带宽 */
  matchBand: number;
  /** 每次匹配返回的对手数 */
  opponentCount: number;
}

export interface PvpReward {
  winCoin: number;
  loseCoin: number;
}

export interface PvpSeasonReward {
  /** 前 topRatio 比例的玩家 */
  topRatio: number;
  coin: number;
}

export interface PvpSeason {
  /** 赛季结算 cron 表达式 */
  cron: string;
  rewards: PvpSeasonReward[];
}

export const PVP_CONFIG = {
  'pvp.rank': defineConfig<PvpRank>({
    description: '天梯积分：初始分、K 系数、匹配分差带宽、每次返回对手数',
    default: {
      initialPoint: 1000,
      kFactor: 24,
      matchBand: 150,
      opponentCount: 3,
    },
    schema: strictObject({
      initialPoint: nonNegInt.max(100000).required(),
      kFactor: posInt.max(1000).required(),
      matchBand: posInt.max(100000).required(),
      opponentCount: posInt.max(20).required(),
    }),
  }),

  'pvp.reward': defineConfig<PvpReward>({
    description: 'PvP 结算奖励：胜负基础币，不并入 pet.daily_cap',
    default: { winCoin: 60, loseCoin: 20 },
    schema: strictObject({
      winCoin: nonNegInt.max(1_000_000).required(),
      loseCoin: nonNegInt.max(1_000_000).required(),
    }),
  }),

  'pvp.season': defineConfig<PvpSeason>({
    description: '赛季结算：cron 表达式与名次奖励档位',
    default: { cron: '0 5 * * 1', rewards: [{ topRatio: 0.1, coin: 2000 }] },
    schema: strictObject({
      cron: Joi.string().max(64).required(),
      rewards: Joi.array()
        .items(
          strictObject({
            topRatio: Joi.number().min(0).max(1).required(),
            coin: nonNegInt.max(10_000_000).required(),
          }),
        )
        .required(),
    }),
  }),
};

export type PvpConfigShape = ShapeOf<typeof PVP_CONFIG>;

// ------------------------------------------------------------------ 纯函数

/** 赛季标识：按自然季度（UTC）。换季即天然重置榜单。 */
export function seasonOf(date: Date): string {
  return `${date.getUTCFullYear()}Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** 上一个季度的赛季标识（用于赛季结算发奖）。 */
export function prevSeasonOf(date: Date): string {
  const q = Math.floor(date.getUTCMonth() / 3); // 0..3
  const y = date.getUTCFullYear();
  return q === 0 ? `${y - 1}Q4` : `${y}Q${q}`;
}
