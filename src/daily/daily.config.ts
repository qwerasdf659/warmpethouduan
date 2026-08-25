/**
 * 签到与每日任务的可调数值。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface CheckinConfig {
  baseCoin: number;
  streakStepCoin: number;
  maxCoin: number;
}

/**
 * 进度来源。这是**结构性**取值：每个值对应一条具体的统计实现
 *（Redis 计数器 key 或签到状态），新增来源必须同时改代码，
 * 故不开放给运营自由填写，只在 schema 里限定为已实现的三种。
 */
export type DailyTaskSource = 'act' | 'play' | 'checkin';

export interface DailyTaskConfig {
  key: string;
  name: string;
  /** 完成所需进度 */
  target: number;
  /** 完成奖励游戏币 */
  coin: number;
  source: DailyTaskSource;
}

// ------------------------------------------------------------------ 默认值

const DEFAULT_CHECKIN: CheckinConfig = {
  baseCoin: 20,
  streakStepCoin: 10,
  maxCoin: 100,
};

const DEFAULT_TASKS: DailyTaskConfig[] = [
  {
    key: 'checkin',
    name: '完成每日签到',
    target: 1,
    coin: 10,
    source: 'checkin',
  },
  {
    key: 'interact',
    name: '照顾宠物 5 次',
    target: 5,
    coin: 30,
    source: 'act',
  },
  {
    key: 'play',
    name: '陪玩 3 次',
    target: 3,
    coin: 20,
    source: 'play',
  },
];

// ------------------------------------------------------------------ 配置项

export const DAILY_CONFIG = {
  'daily.checkin': defineConfig<CheckinConfig>({
    description: '签到奖励：基础 + (连签天数-1)×步进，封顶 maxCoin',
    default: DEFAULT_CHECKIN,
    schema: strictObject({
      baseCoin: nonNegInt.required(),
      streakStepCoin: nonNegInt.required(),
      maxCoin: nonNegInt.required(),
    }).custom((v: CheckinConfig, helpers) =>
      // 封顶低于基础值等于「签到越久拿越少」，必然是误填
      v.maxCoin < v.baseCoin
        ? helpers.error('any.invalid', { message: 'maxCoin 不能小于 baseCoin' })
        : v,
    ),
  }),

  'daily.tasks': defineConfig<DailyTaskConfig[]>({
    description:
      '每日任务列表：进度来源限 act(互动次数)/play(陪玩)/checkin(签到)',
    default: DEFAULT_TASKS,
    schema: Joi.array()
      .min(1)
      .items(
        strictObject({
          key: Joi.string().max(32).required(),
          name: Joi.string().max(64).required(),
          target: posInt.required(),
          coin: nonNegInt.required(),
          source: Joi.string().valid('act', 'play', 'checkin').required(),
        }),
      )
      .required(),
  }),
};

export type DailyConfigShape = ShapeOf<typeof DAILY_CONFIG>;

// ------------------------------------------------------------------ 纯函数

/** 由连签天数推出当日签到奖励游戏币。 */
export function checkinRewardOf(streak: number, cfg: CheckinConfig): number {
  const n = Math.max(1, streak);
  return Math.min(cfg.maxCoin, cfg.baseCoin + (n - 1) * cfg.streakStepCoin);
}
