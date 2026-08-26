/**
 * 赛跑可调数值。
 *
 * 结果由服务端权威计算：以出战宠的 speed/endurance/mood 算出**完赛时间**
 * `finishTime`，对手（影子）各自也有完赛时间，名次即完赛时间升序排位，
 * 评级由完赛时间比对赛道基准时间得出。装扮不加属性，保证「外观即战力」
 * 不成立、赛跑公平。
 *
 * 奖励口径仍按**名次**折算（`rewardOfRank`），改判定模型不改经济产出，
 * 避免顺手把线上收益曲线一起动掉。
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
  /** 赛道距离：参与完赛时间计算（距离越长，耐力不足的掉速越明显） */
  distance: number;
  /** 难度系数：>1 越难，影子对手越快 */
  difficulty: number;
  /** 报名消耗体力 */
  staminaCost: number;
  /** 报名门票（游戏币），0 为免费 */
  entryCoin: number;
  /** 第 1 名基准奖励（游戏币），其余名次按 rank_factor 折算 */
  baseReward: number;
  /** 建议等级（前端展示，不做硬限制） */
  recommendLevel: number;
  /** 评级基准完赛时间（秒）：finishTime / targetTime 比对 grade_thresholds 得评级 */
  targetTime: number;
}

export interface RaceRevive {
  maxPerRace: number;
  /** 重跑时给玩家得分的小幅加成（补偿「已经跑砸过一次」） */
  scoreBonus: number;
}

/** 完赛时间公式参数。改这里等于改赛跑手感，改前先看 §10.2。 */
export interface RaceFormula {
  /** 配速常数：basePace = paceConstant / (speed × moodFactor) */
  paceConstant: number;
  /** 心情最低时保留的配速系数（mood=0 时的 moodFactor） */
  moodBase: number;
  /** 心情满时额外增加的配速系数（moodFactor = moodBase + moodSpan × mood/100） */
  moodSpan: number;
  /** 耐力基准：endurance 达到该值即无后程掉速 */
  enduranceBase: number;
  /** 后程掉速强度：fade = 缺口比例 × distance × fadeFactor */
  fadeFactor: number;
  /** 完赛时间随机扰动幅度（±比例） */
  jitter: number;
}

/** 评级阈值：finishTime / track.targetTime 的上界，超过最后一档即最低评级。 */
export interface RaceGradeThresholds {
  S: number;
  A: number;
  B: number;
}

export type RaceGrade = 'S' | 'A' | 'B' | 'C';

/** 影子对手采样参数（真实玩家成绩，不够则 NPC 兜底）。 */
export interface RaceGhost {
  /** 是否采样真实玩家成绩 */
  enabled: boolean;
  /** 同赛道等级带：只取 |petLevel − 自己| <= 该值的成绩 */
  levelBand: number;
  /** 回溯天数：太老的成绩不代表当前版本强度 */
  lookbackDays: number;
  /** 采样不足该条数就整场退回 NPC（避免只有 1 个影子导致名次失真） */
  minSamples: number;
  /** 采样值下钳系数：低于 baseTime × clampMin 视为异常（刷榜/改档），钳回 */
  clampMin: number;
  /** 采样值上钳系数：高于 baseTime × clampMax 视为摆烂样本，钳回 */
  clampMax: number;
}

// ------------------------------------------------------------------ 默认值

/**
 * `targetTime` = 「建议等级 + 心情满值」跑该赛道的期望耗时（上取整），
 * 即达到 recommendLevel 正常拿 A。
 * 例：meadow 距离 100，lv1 speed=10 → basePace=2/10=0.2 → 20s，
 * 耐力缺口 (1−10/40)=0.75 → fade=0.75×100×0.05≈3.8s，合计 23.75 → 24s。
 */
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
    targetTime: 24,
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
    targetTime: 36,
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
    targetTime: 37,
  },
];

const DEFAULT_REVIVE: RaceRevive = { maxPerRace: 1, scoreBonus: 1.05 };

const DEFAULT_RANK_FACTOR: number[] = [1, 0.6, 0.35, 0.15];

const DEFAULT_FORMULA: RaceFormula = {
  paceConstant: 2,
  moodBase: 0.8,
  moodSpan: 0.2,
  enduranceBase: 40,
  fadeFactor: 0.05,
  jitter: 0.05,
};

/**
 * 语义：A = 跑到赛道基准（达标），S = 比基准快 10% 以上，
 * B = 慢于基准但在 15% 以内，C = 更慢。
 * 把 A 定在 1.0 而不是 0.95，是为了让「建议等级 + 心情正常」稳定拿 A——
 * 阈值卡在基准以下时，达标玩家会因为 ±5% 扰动随机掉到 B，手感很差。
 */
const DEFAULT_GRADE_THRESHOLDS: RaceGradeThresholds = {
  S: 0.9,
  A: 1.0,
  B: 1.15,
};

const DEFAULT_GHOST: RaceGhost = {
  enabled: true,
  levelBand: 3,
  lookbackDays: 30,
  minSamples: 2,
  clampMin: 0.7,
  clampMax: 1.6,
};

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
          // 基准时间 <=0 会让评级比值除零
          targetTime: Joi.number().min(0.1).max(100_000).required(),
        }),
      )
      .required(),
  }),

  'race.formula': defineConfig<RaceFormula>({
    description: '完赛时间公式：配速常数、心情权重、耐力基准、后程掉速与扰动',
    default: DEFAULT_FORMULA,
    schema: strictObject({
      paceConstant: Joi.number().min(0.01).max(1000).required(),
      // moodBase=0 会让心情归零的宠物完赛时间变成无穷大
      moodBase: Joi.number().min(0.01).max(1).required(),
      moodSpan: Joi.number().min(0).max(10).required(),
      enduranceBase: Joi.number().min(0.1).max(100_000).required(),
      fadeFactor: Joi.number().min(0).max(10).required(),
      // 扰动 >=1 会让完赛时间出现 0 或负数
      jitter: Joi.number().min(0).max(0.9).required(),
    }),
  }),

  'race.grade_thresholds': defineConfig<RaceGradeThresholds>({
    description: '评级阈值（finishTime / track.targetTime 的上界），超 B 即 C',
    default: DEFAULT_GRADE_THRESHOLDS,
    schema: strictObject({
      S: Joi.number().min(0.01).max(100).required(),
      A: Joi.number().min(0.01).max(100).required(),
      B: Joi.number().min(0.01).max(100).required(),
    }).custom((v: RaceGradeThresholds, helpers) =>
      // 阈值必须递增，否则高评级永远拿不到（S 比 A 宽等于 S 失效）
      v.S < v.A && v.A < v.B
        ? v
        : helpers.error('any.invalid', {
            message: '评级阈值必须满足 S < A < B',
          }),
    ),
  }),

  'race.ghost': defineConfig<RaceGhost>({
    description: '影子对手：是否采样真实玩家成绩、等级带、回溯期与异常值钳制',
    default: DEFAULT_GHOST,
    schema: strictObject({
      enabled: Joi.boolean().required(),
      levelBand: nonNegInt.max(999).required(),
      lookbackDays: posInt.max(3650).required(),
      minSamples: nonNegInt.max(50).required(),
      clampMin: Joi.number().min(0.01).max(10).required(),
      clampMax: Joi.number().min(0.01).max(100).required(),
    }).custom((v: RaceGhost, helpers) =>
      v.clampMin < v.clampMax
        ? v
        : helpers.error('any.invalid', {
            message: 'clampMin 必须小于 clampMax',
          }),
    ),
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

/**
 * 无扰动的基准完赛时间（秒）。
 *
 * `mood` 参与配速：心情越差跑得越慢（moodFactor 从 moodBase 线性升到
 * moodBase+moodSpan）。耐力低于基准时按距离比例产生**后程掉速**，
 * 所以长赛道更吃耐力——这正是三围分工的意义。
 *
 * 返回值只保留 3 位小数：完赛时间要落库、要参与名次比较，
 * 留浮点尾巴会让「同样的输入两次算出不同名次」这类问题极难复现。
 */
export function baseFinishTime(
  stat: { speed: number; endurance: number; mood: number },
  track: RaceTrack,
  f: RaceFormula,
): number {
  const moodFactor = f.moodBase + f.moodSpan * (clamp01(stat.mood / 100) || 0);
  // speed 为 0 的宠不存在（速度有基础值），但配置可被改到 0，兜一下避免除零
  const effectiveSpeed =
    Math.max(0.01, stat.speed) * Math.max(0.01, moodFactor);
  const basePace = f.paceConstant / effectiveSpeed;
  const gap = Math.max(0, 1 - stat.endurance / Math.max(0.01, f.enduranceBase));
  const fade = gap * track.distance * f.fadeFactor;
  return round3(track.distance * basePace + fade);
}

/** 给基准完赛时间加 ±jitter 扰动（同一场里玩家与影子各自独立掷）。 */
export function jitterTime(
  base: number,
  jitter: number,
  rand: () => number = Math.random,
): number {
  const factor = 1 - jitter + rand() * jitter * 2;
  return round3(Math.max(0.001, base * factor));
}

/**
 * 影子对手的完赛时间：以玩家基准时间按赛道难度缩放。
 *
 * 用玩家自己的基准作锚点（而不是绝对时间），是为了让低等级宠在低难度赛道
 * 也有得赢、高等级宠在高难度赛道仍有挑战——否则新手永远垫底、满级永远第一。
 */
export function npcFinishTime(
  playerBase: number,
  track: RaceTrack,
  rand: () => number = Math.random,
): number {
  // 难度越高，对手耗时越短（跑得越快）；0.8~1.05 与旧战力模型的扰动区间一致
  const strength = Math.max(0.01, track.difficulty) * (0.8 + rand() * 0.25);
  return round3(Math.max(0.001, playerBase / strength));
}

/** 完赛时间 → 评级（比对赛道基准时间）。 */
export function gradeOf(
  finishTime: number,
  track: RaceTrack,
  th: RaceGradeThresholds,
): RaceGrade {
  const ratio = finishTime / Math.max(0.01, track.targetTime);
  if (ratio <= th.S) return 'S';
  if (ratio <= th.A) return 'A';
  if (ratio <= th.B) return 'B';
  return 'C';
}

/** 名次 = 1 + 比自己快的影子数量（完赛时间升序）。 */
export function rankOf(playerTime: number, opponentTimes: number[]): number {
  return 1 + opponentTimes.filter((t) => t < playerTime).length;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
