/**
 * 赛跑可调数值。
 *
 * 结果由服务端权威计算：以出战宠的 speed/endurance 派生基础战力，
 * 对手战力按赛道难度缩放并加随机扰动，名次即战力排序。装扮不加属性，
 * 保证「外观即战力」不成立、赛跑公平。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface RaceTrack {
  key: string;
  name: string;
  /** 赛道距离（仅用于展示与演出时长换算） */
  distance: number;
  /** 难度系数：>1 越难，对手战力越强 */
  difficulty: number;
  /** 报名消耗体力 */
  staminaCost: number;
  /** 报名门票（游戏币），0 为免费 */
  entryCoin: number;
  /** 第 1 名基准奖励（游戏币），其余名次按 rank_factor 折算 */
  baseReward: number;
  /** 建议等级（前端展示，不做硬限制） */
  recommendLevel: number;
}

export interface RaceRevive {
  maxPerRace: number;
  /** 重跑时给玩家得分的小幅加成（补偿「已经跑砸过一次」） */
  scoreBonus: number;
}

// ------------------------------------------------------------------ 默认值

const DEFAULT_TRACKS: RaceTrack[] = [
  {
    key: 'meadow',
    name: '新手草地',
    distance: 100,
    difficulty: 1.0,
    staminaCost: 20,
    entryCoin: 0,
    baseReward: 50,
    recommendLevel: 1,
  },
  {
    key: 'forest',
    name: '密林赛道',
    distance: 200,
    difficulty: 1.3,
    staminaCost: 35,
    entryCoin: 20,
    baseReward: 120,
    recommendLevel: 5,
  },
  {
    key: 'mountain',
    name: '峭壁险道',
    distance: 300,
    difficulty: 1.6,
    staminaCost: 50,
    entryCoin: 50,
    baseReward: 250,
    recommendLevel: 12,
  },
];

const DEFAULT_REVIVE: RaceRevive = { maxPerRace: 1, scoreBonus: 1.05 };

const DEFAULT_RANK_FACTOR: number[] = [1, 0.6, 0.35, 0.15];

// ------------------------------------------------------------------ 配置项

export const RACE_CONFIG = {
  'race.tracks': defineConfig<RaceTrack[]>({
    description: '赛道目录：难度、体力消耗、门票与基准奖励',
    default: DEFAULT_TRACKS,
    schema: Joi.array()
      .min(1)
      .items(
        strictObject({
          key: Joi.string().max(32).required(),
          name: Joi.string().max(32).required(),
          distance: posInt.required(),
          // 难度 <=0 会让对手战力归零或反向
          difficulty: Joi.number().min(0.1).max(100).required(),
          staminaCost: nonNegInt.required(),
          entryCoin: nonNegInt.required(),
          baseReward: nonNegInt.required(),
          recommendLevel: posInt.required(),
        }),
      )
      .required(),
  }),

  'race.opponent_count': defineConfig<number>({
    description: '每场对手 AI 数量（参赛总数 = 玩家 1 + 该值）',
    default: 3,
    schema: posInt.max(50).required(),
  }),

  'race.revive': defineConfig<RaceRevive>({
    description: '看广告复活重跑：每场次数上限与得分加成',
    default: DEFAULT_REVIVE,
    schema: strictObject({
      // 允许 0 = 关闭复活功能；上限 10 防误填成无限重掷
      maxPerRace: nonNegInt.max(10).required(),
      scoreBonus: Joi.number().min(1).max(10).required(),
    }),
  }),

  'race.rank_factor': defineConfig<number[]>({
    description: '各名次相对第 1 名奖励的折算系数（索引 = 名次-1）',
    default: DEFAULT_RANK_FACTOR,
    schema: Joi.array().min(1).items(Joi.number().min(0).max(10)).required(),
  }),
};

export type RaceConfigShape = ShapeOf<typeof RACE_CONFIG>;

// ------------------------------------------------------------------ 纯函数

export function getTrack(
  tracks: RaceTrack[],
  key: string,
): RaceTrack | undefined {
  return tracks.find((t) => t.key === key);
}

/** 由名次与赛道基准算奖励游戏币（超出档位按最后一档）。 */
export function rewardOfRank(
  track: RaceTrack,
  rank: number,
  rankFactor: number[],
): number {
  const factor = rankFactor[Math.min(rank - 1, rankFactor.length - 1)] ?? 0;
  return Math.round(track.baseReward * factor);
}
