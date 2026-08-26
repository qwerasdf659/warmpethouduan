import { Pet } from '../entities/pet.entity';
import {
  STAT_MAX,
  STAT_MIN,
  type PetActionConfig,
  type PetActionKey,
  type PetAttrs,
  type PetComfort,
  type PetDailyCap,
  type PetGrowth,
  type PetOffline,
  type PetRates,
  type PetStage,
} from './pet.config';

/**
 * 宠物域的**纯计算**：衰减结算、等级推导、出参映射。
 *
 * 单独成文件而不是留在 PetService 里，是因为这些函数不碰仓储 / Redis / 时钟 ——
 * 全部输入都在参数里。放在一起时它们和一堆需要 mock 八个依赖才能跑的业务方法混编，
 * 想单独验一条衰减公式得先把整个服务搭起来。拆出来后 pet.service 只剩编排。
 *
 * 约定：本文件不得引入任何需要注入的依赖；需要「现在几点」就让调用方把 now 传进来。
 */

/** 结算后的宠物快照（对外出参，camelCase）。 */
export interface PetStateView {
  id: string;
  nickname: string | null;
  species: string;
  isActive: boolean;
  hunger: number;
  cleanliness: number;
  mood: number;
  stamina: number;
  staminaMax: number;
  intimacy: number;
  level: number;
  exp: number;
  /** 当前等级内已累积 exp */
  expIntoLevel: number;
  /** 升下一级还需 exp（满级为 0） */
  expToNext: number;
  stage: string;
  speed: number;
  endurance: number;
  lastSeenAt: string;
}

/** 惰性结算后的可变状态（纯计算产物，未落库）。 */
export interface SettledStats {
  hunger: number;
  cleanliness: number;
  mood: number;
  stamina: number;
  intimacy: number;
  exp: number;
}

/**
 * 一次请求内用到的宠物域配置快照。
 *
 * 显式当参数往下传，而不是让各函数自己去读配置服务：
 *  - 保证同一次请求内衰减速率、成长曲线、上限口径完全一致（读一半配置被改掉会算出矛盾结果）；
 *  - 让 settle/levelOf 这些纯计算保持同步且可单测，不必为了取配置变成 async。
 */
export interface PetTuning {
  rates: PetRates;
  growth: PetGrowth;
  attrs: PetAttrs;
  stages: PetStage[];
  actions: Record<PetActionKey, PetActionConfig>;
  dailyCap: PetDailyCap;
  maxPets: number;
  offline: PetOffline;
  comfort: PetComfort;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

export function clampStat(v: number): number {
  return clamp(v, STAT_MIN, STAT_MAX);
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** 由累计 exp 推出等级与本级进度。 */
export function levelOf(
  totalExp: number,
  growth: PetGrowth,
): { level: number; expIntoLevel: number; expToNext: number } {
  let level = 1;
  let need: number = growth.baseExp;
  let remaining = Math.max(0, totalExp);

  while (level < growth.maxLevel && remaining >= need) {
    remaining -= need;
    level += 1;
    need = Math.round(need * growth.ratio);
  }

  return {
    level,
    expIntoLevel: remaining,
    expToNext: level >= growth.maxLevel ? 0 : need - remaining,
  };
}

export function staminaMaxOf(level: number, attrs: PetAttrs): number {
  return attrs.staminaMaxBase + attrs.staminaMaxPerLevel * (level - 1);
}

export function stageOf(level: number, stages: PetStage[]): string {
  return (
    stages.find((s) => level <= s.maxLevel)?.key ??
    stages[stages.length - 1].key
  );
}

/**
 * 惰性结算：把库里的值按 elapsed 推进到「当前」。纯函数、不落库。
 *
 * 心情为派生量：基础按 moodBase/h 掉；饱食度或清洁度触底后的那段时间再额外
 * 按 moodStarving/h 掉；整体再乘 (1 − comfortFactor)。
 */
export function settle(
  pet: Pet,
  now: Date,
  comfortFactor: number,
  t: PetTuning,
): SettledStats {
  const { rates } = t;
  const elapsedH = Math.max(
    0,
    (now.getTime() - new Date(pet.lastSeenAt).getTime()) / 3_600_000,
  );

  const hunger = clampStat(pet.hunger - rates.hunger * elapsedH);
  const cleanliness = clampStat(pet.cleanliness - rates.cleanliness * elapsedH);

  // 各自触底所需小时数 → 取更早触底者，之后的时长按「饿/脏」加速掉心情。
  // 速率为 0 时永不触底，用 Infinity 表达，避免除零得出 NaN。
  const hungerZeroH =
    rates.hunger > 0 ? pet.hunger / rates.hunger : Number.POSITIVE_INFINITY;
  const cleanZeroH =
    rates.cleanliness > 0
      ? pet.cleanliness / rates.cleanliness
      : Number.POSITIVE_INFINITY;
  const starvingH = Math.max(0, elapsedH - Math.min(hungerZeroH, cleanZeroH));
  const moodDecay =
    (rates.moodBase * elapsedH + rates.moodStarving * starvingH) *
    (1 - comfortFactor);

  const staminaMax = staminaMaxOf(levelOf(pet.exp, t.growth).level, t.attrs);

  return {
    hunger,
    cleanliness,
    mood: clampStat(pet.mood - moodDecay),
    stamina: clamp(pet.stamina + rates.stamina * elapsedH, 0, staminaMax),
    intimacy: pet.intimacy,
    exp: pet.exp,
  };
}

/** 刚落库后的快照（无需再衰减）。 */
export function snapshot(pet: Pet): SettledStats {
  return {
    hunger: pet.hunger,
    cleanliness: pet.cleanliness,
    mood: pet.mood,
    stamina: pet.stamina,
    intimacy: pet.intimacy,
    exp: pet.exp,
  };
}

export function toView(pet: Pet, s: SettledStats, t: PetTuning): PetStateView {
  const { attrs } = t;
  const progress = levelOf(s.exp, t.growth);
  const level = progress.level;
  return {
    id: pet.id,
    nickname: pet.nickname,
    species: pet.species,
    isActive: pet.isActive,
    hunger: s.hunger,
    cleanliness: s.cleanliness,
    mood: s.mood,
    stamina: s.stamina,
    staminaMax: staminaMaxOf(level, attrs),
    intimacy: s.intimacy,
    level,
    exp: s.exp,
    expIntoLevel: progress.expIntoLevel,
    expToNext: progress.expToNext,
    stage: stageOf(level, t.stages),
    speed: round1(attrs.speedBase + attrs.speedPerLevel * (level - 1)),
    endurance: round1(
      attrs.enduranceBase + attrs.endurancePerLevel * (level - 1),
    ),
    lastSeenAt: new Date(pet.lastSeenAt).toISOString(),
  };
}
