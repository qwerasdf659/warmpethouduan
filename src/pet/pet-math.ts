import type { ConfigShape } from '../config/game-config.registry';
import { Pet } from '../entities/pet.entity';
import {
  STAT_MAX,
  STAT_MIN,
  comfortFactorOf,
  type PetActionConfig,
  type PetActionKey,
  type PetAttrs,
  type PetComfort,
  type PetDailyCap,
  type PetGrowth,
  type PetOffline,
  type PetRates,
  type PetStage,
  type PetTraitDef,
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
  /** P8 形态：normal | glow | rainbow */
  form: string;
  /** P8 稀有度 key */
  rarity: string;
  /** P8 生命状态：active | fused */
  status: string;
  /** P10 性格特质（展示用，含配置解析出的名称与效果；前端不参与计算） */
  traits: Array<{
    key: string;
    name: string;
    desc: string;
    effects: Record<string, number>;
  }>;
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
  /** P10：用于把 pet.traits 的 key 数组解析成带名称/效果的展示对象 */
  traitDefs: PetTraitDef[];
}

/**
 * 把一份配置快照收拢成 `PetTuning`。
 *
 * pet / breed / fusion / training 四个服务都要这份口径，此前各自维护了一份逐字
 * 相同的私有 `tuning()`。四份拷贝的问题不在冗余而在**漏改**：`traitDefs` 这一项
 * 加进 `PetTuning` 时，只有真正跑到那条代码路径的服务会被类型检查逼着补上，
 * 其余几份要等到运行时读到 undefined 才暴露。
 *
 * 保持纯函数（不 async）：取快照是调用方的事，本函数只负责映射，
 * 这样单测里直接喂一个字面量对象即可，不必搭配置服务。
 */
export function buildPetTuning(c: ConfigShape): PetTuning {
  return {
    rates: c['pet.rates'],
    growth: c['pet.growth'],
    attrs: c['pet.attrs'],
    stages: c['pet.stages'],
    actions: c['pet.actions'],
    dailyCap: c['pet.daily_cap'],
    maxPets: c['pet.max_pets_per_user'],
    offline: c['pet.offline'],
    comfort: c['pet.comfort'],
    traitDefs: c['pet.traits'],
  };
}

/**
 * 等级所处的成长阶段下标。用于「必须成年才能繁育/融合」这类门槛判定。
 * 找不到（配置被改到不覆盖该等级）时返回最后一档，宁可放行也不要把玩家卡死。
 */
export function stageIndexOf(level: number, stages: PetStage[]): number {
  const i = stages.findIndex((s) => level <= s.maxLevel);
  return i === -1 ? stages.length - 1 : i;
}

/**
 * 先把属性衰减结算到 `now`，再扣 `cost` 点体力，**就地改写 `pet`**（不落库）。
 * 体力不足时返回 false 且不做任何改动，由调用方决定怎么报错。
 *
 * 舒适度取值由调用方传入而不是在这里查：本文件的约定是不碰任何需要注入的依赖，
 * 而舒适度要读家园布局。返回 boolean 而不是直接抛 `BadRequestException`，
 * 同样是为了不把 Nest 的 HTTP 语义渗进纯计算层。
 */
export function spendStamina(
  pet: Pet,
  t: PetTuning,
  cost: number,
  now: Date,
  comfort: number,
): boolean {
  const cur = settle(pet, now, comfortFactorOf(comfort, t.comfort), t);
  if (cur.stamina < cost) return false;

  const level = levelOf(cur.exp, t.growth).level;
  pet.hunger = cur.hunger;
  pet.cleanliness = cur.cleanliness;
  pet.mood = cur.mood;
  pet.stamina = clamp(
    cur.stamina - cost,
    0,
    staminaMaxOf(level, t.attrs, pet.staminaBonusBps ?? 0),
  );
  pet.intimacy = cur.intimacy;
  pet.exp = cur.exp;
  pet.level = level;
  pet.lastSeenAt = now;
  return true;
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

export function staminaMaxOf(
  level: number,
  attrs: PetAttrs,
  bonusBps = 0,
): number {
  const base = attrs.staminaMaxBase + attrs.staminaMaxPerLevel * (level - 1);
  // P3 繁殖遗传的体力上限加成（基点）；默认 0 对既有调用零影响。
  return Math.round(base * (1 + bonusBps / 10000));
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
/**
 * 衰减/恢复倍率增量（P1 病症不含衰减键；P10 特质 / P2 Petpet / P8 融合形态 / P13 技巧掌握 均可贡献）。
 *
 * `PetBonus`（`PetBonusService.bonusOf`）结构上是本类型的超集，可直接传入，
 * 一次给全所有来源，避免「特质在 settle 里算一遍、其它来源又算一遍」的重复计数。
 */
export interface PetDecayMod {
  hungerDecay?: number;
  cleanDecay?: number;
  moodDecay?: number;
  staminaRecover?: number;
}

function decayedRates(t: PetTuning, decay?: PetDecayMod): PetRates {
  const b = t.rates;
  const d = decay ?? {};
  // 倍率增量作用于速率；下钳到 0，避免多个负向修正叠加出「负衰减」（状态自己长回来）。
  return {
    hunger: Math.max(0, b.hunger * (1 + (d.hungerDecay ?? 0))),
    cleanliness: Math.max(0, b.cleanliness * (1 + (d.cleanDecay ?? 0))),
    moodBase: Math.max(0, b.moodBase * (1 + (d.moodDecay ?? 0))),
    moodStarving: Math.max(0, b.moodStarving * (1 + (d.moodDecay ?? 0))),
    stamina: Math.max(0, b.stamina * (1 + (d.staminaRecover ?? 0))),
  };
}

export function settle(
  pet: Pet,
  now: Date,
  comfortFactor: number,
  t: PetTuning,
  decay?: PetDecayMod,
): SettledStats {
  // 应用衰减/恢复修正（无修正时等于原速率，行为不变）
  const rates = decayedRates(t, decay);
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

  const staminaMax = staminaMaxOf(
    levelOf(pet.exp, t.growth).level,
    t.attrs,
    pet.staminaBonusBps ?? 0,
  );

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
  const traitDefs = t.traitDefs ?? [];
  const traits = (pet.traits ?? []).map((key) => {
    const def = traitDefs.find((d) => d.key === key);
    return {
      key,
      name: def?.name ?? key,
      desc: def?.desc ?? '',
      effects: (def?.effects ?? {}) as Record<string, number>,
    };
  });
  return {
    id: pet.id,
    nickname: pet.nickname,
    species: pet.species,
    isActive: pet.isActive,
    hunger: s.hunger,
    cleanliness: s.cleanliness,
    mood: s.mood,
    stamina: s.stamina,
    staminaMax: staminaMaxOf(level, attrs, pet.staminaBonusBps ?? 0),
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
    form: pet.form ?? 'normal',
    rarity: pet.rarity ?? 'common',
    status: pet.status ?? 'active',
    traits,
    lastSeenAt: new Date(pet.lastSeenAt).toISOString(),
  };
}
