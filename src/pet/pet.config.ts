/**
 * 宠物域全部可调数值。集中在此便于运营调参，
 * 后续迁到 DB 配置表（`*_def`）时只替换这一层的取值来源。
 */

export const STAT_MIN = 0;
export const STAT_MAX = 100;

/** 每小时衰减/恢复速率（服务端权威，按 last_seen_at 到 now 的真实时长计算）。 */
export const RATE_PER_HOUR = {
  hunger: 5,
  cleanliness: 3,
  /** 心情基础衰减 */
  moodBase: 2,
  /** 饱食度或清洁度触底后，心情的额外衰减 */
  moodStarving: 3,
  /** 体力自然恢复 */
  stamina: 10,
} as const;

/** 成长曲线：Lv1→2 需 100 exp，之后每级 ×1.2。 */
export const GROWTH = {
  baseExp: 100,
  ratio: 1.2,
  maxLevel: 100,
} as const;

/**
 * 三围属性成长（**派生，不落库**）：属性只由等级决定，装扮不加属性，
 * 保证赛跑公平（避免「外观即战力」）。
 */
export const ATTRS = {
  staminaMaxBase: 100,
  staminaMaxPerLevel: 2,
  speedBase: 10,
  speedPerLevel: 1.0,
  enduranceBase: 10,
  endurancePerLevel: 0.8,
} as const;

/** 成长阶段（影响外观换模/进化演出）。 */
export const STAGES = [
  { key: 'baby', maxLevel: 5 },
  { key: 'teen', maxLevel: 15 },
  { key: 'adult', maxLevel: GROWTH.maxLevel },
] as const;

export type PetActionKey = 'feed' | 'bath' | 'pet' | 'play';

export interface PetActionConfig {
  /** 状态增益（可为负，如 play 消耗体力） */
  effects: Partial<
    Record<'hunger' | 'cleanliness' | 'mood' | 'stamina', number>
  >;
  /** 冷却毫秒 */
  cooldownMs: number;
  /** 产出（受每日上限约束）：亲密度/经验落宠物、coin 进游戏币钱包 */
  gain: { intimacy: number; exp: number; coin: number };
}

export const ACTIONS: Record<PetActionKey, PetActionConfig> = {
  feed: {
    effects: { hunger: 30 },
    cooldownMs: 30_000,
    gain: { intimacy: 2, exp: 5, coin: 3 },
  },
  bath: {
    effects: { cleanliness: 40 },
    cooldownMs: 60_000,
    gain: { intimacy: 2, exp: 5, coin: 3 },
  },
  pet: {
    effects: { mood: 15 },
    cooldownMs: 20_000,
    gain: { intimacy: 3, exp: 3, coin: 2 },
  },
  play: {
    effects: { mood: 20, stamina: -10 },
    cooldownMs: 60_000,
    gain: { intimacy: 4, exp: 8, coin: 5 },
  },
};

/**
 * 每日产出上限（防刷），**账号级**（多宠共享）。达上限后动作仍可做但不再发放。
 * coin 为互动产出的游戏币上限，与离线/赛跑/签到等其它来源相互独立。
 */
export const DAILY_CAP = {
  intimacy: 100,
  exp: 200,
  coin: 500,
} as const;

export type DailyCapResource = keyof typeof DAILY_CAP;

/** 每个玩家最多养几只宠物。 */
export const MAX_PETS_PER_USER = 6;

/**
 * 离线收益：按离线时长发放游戏币，封顶 maxHours（防挂机囤积）。
 * 每级出战宠对时薪的加成 perLevelBonus（线性小幅，避免碾压在线玩法）。
 */
export const OFFLINE = {
  coinPerHour: 10,
  maxHours: 8,
  /** 出战宠每级对时薪的加成系数（level=1 无加成） */
  perLevelBonus: 0.05,
} as const;

/**
 * 家园舒适度对心情衰减的减免。comfortFactor = min(comfort / COMFORT_MAX, cap)。
 * 达到 COMFORT_MAX 即触顶（再堆家具无收益，避免无限减免）。
 */
export const COMFORT_FACTOR_CAP = 0.3;
export const COMFORT_MAX = 100;

/** 由家园舒适度换算心情衰减减免系数（0 ~ COMFORT_FACTOR_CAP）。 */
export function comfortFactorOf(comfort: number): number {
  const raw = Math.max(0, comfort) / COMFORT_MAX;
  return Math.min(raw, COMFORT_FACTOR_CAP);
}

/** 业务日切时区固定东八区（无 DST，用固定偏移即精确）。 */
export const BUSINESS_TZ_OFFSET_MS = 8 * 3_600_000;
