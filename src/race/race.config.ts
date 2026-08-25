/**
 * 赛跑赛道配置（可调数值集中处，后续可迁 DB 的 race_track_def 表）。
 *
 * 结果由服务端权威计算：以出战宠的 speed/endurance 派生基础战力，
 * 对手战力按赛道难度缩放并加随机扰动，名次即战力排序。装扮不加属性，
 * 保证「外观即战力」不成立、赛跑公平。
 */

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
  /** 第 1 名基准奖励（游戏币），其余名次按 RANK_FACTOR 折算 */
  baseReward: number;
  /** 建议等级（前端展示，不做硬限制） */
  recommendLevel: number;
}

export const RACE_TRACKS: RaceTrack[] = [
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

/** 参赛总数 = 玩家 1 + 对手 AI 数。 */
export const OPPONENT_COUNT = 3;

/**
 * 看广告复活重跑：不再扣体力/门票，直接按当前战力重掷一次名次。
 * 限每场一次，否则玩家可反复重掷直到第一名，赛跑就没有风险成本了。
 */
export const RACE_REVIVE = {
  maxPerRace: 1,
  /** 重跑时给玩家得分的小幅加成（补偿「已经跑砸过一次」） */
  scoreBonus: 1.05,
} as const;

/** 各名次相对第 1 名基准奖励的折算系数（索引 = 名次-1）。 */
export const RANK_FACTOR = [1, 0.6, 0.35, 0.15] as const;

export function getTrack(key: string): RaceTrack | undefined {
  return RACE_TRACKS.find((t) => t.key === key);
}

/** 由名次与赛道基准算奖励游戏币（超出档位按最后一档）。 */
export function rewardOfRank(track: RaceTrack, rank: number): number {
  const factor = RANK_FACTOR[Math.min(rank - 1, RANK_FACTOR.length - 1)] ?? 0;
  return Math.round(track.baseReward * factor);
}
