/**
 * 宠物域可调数值。
 *
 * 这里的常量同时是**启动种子的初值**与**DB 缺失/脏数据时的兜底**，
 * 运行时的权威取值来自 `GameConfigService`（DB 优先）。
 * 新增可调项：在下方 `PET_CONFIG` 里加一条，注册表会自动带上。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

/**
 * 状态值上下界属于**结构性**约束（DTO 与前端进度条都按 0~100 呈现），
 * 不开放给运营，故留在代码里。
 */
export const STAT_MIN = 0;
export const STAT_MAX = 100;

export type PetActionKey = 'feed' | 'bath' | 'pet' | 'play';

// ------------------------------------------------------------------ 值类型

export interface PetRates {
  hunger: number;
  cleanliness: number;
  /** 心情基础衰减 */
  moodBase: number;
  /** 饱食度或清洁度触底后，心情的额外衰减 */
  moodStarving: number;
  /** 体力自然恢复 */
  stamina: number;
}

export interface PetGrowth {
  baseExp: number;
  ratio: number;
  maxLevel: number;
}

export interface PetAttrs {
  staminaMaxBase: number;
  staminaMaxPerLevel: number;
  speedBase: number;
  speedPerLevel: number;
  enduranceBase: number;
  endurancePerLevel: number;
}

export interface PetStage {
  key: string;
  maxLevel: number;
}

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

export interface PetDailyCap {
  intimacy: number;
  exp: number;
  coin: number;
}

export type DailyCapResource = keyof PetDailyCap;

export interface PetOffline {
  coinPerHour: number;
  maxHours: number;
  /** 出战宠每级对时薪的加成系数（level=1 无加成） */
  perLevelBonus: number;
}

export interface PetComfort {
  /** 心情衰减减免上限 */
  factorCap: number;
  /** 达到该舒适度即触顶（再堆家具无收益） */
  max: number;
}

// ---------------------------------------------------------------- P10 性格特质

/**
 * 特质效果：只允许收益类与衰减类倍率增量，**绝不含 speed/endurance**
 *（三围只由等级决定，性格影响赛跑等于把赛跑变成抽卡）。
 */
export interface PetTraitEffects {
  feedGain?: number;
  petGain?: number;
  playGain?: number;
  hungerDecay?: number;
  cleanDecay?: number;
  moodDecay?: number;
  staminaRecover?: number;
}

export interface PetTraitDef {
  key: string;
  name: string;
  desc: string;
  /** 出生随机分配的权重 */
  weight: number;
  effects: PetTraitEffects;
}

export interface PetTraitCount {
  min: number;
  max: number;
}

// ---------------------------------------------------------------- P1 疾病

export type PetConditionSource = 'hunger' | 'cleanliness' | 'mood';

/** 病症减益：只降收益，键与特质/Petpet 加成同构，进同一聚合层。 */
export interface PetConditionEffects {
  offlineRate?: number;
  intimacyGain?: number;
  raceScore?: number;
}

export interface PetConditionDef {
  key: string;
  name: string;
  desc: string;
  /** 观察哪个属性归零 */
  source: PetConditionSource;
  /** 归零满多少小时即触发 */
  thresholdHours: number;
  effects: PetConditionEffects;
}

export interface PetCureConfig {
  /** 用药治疗消耗的道具 code */
  itemKey: string;
  /** 看诊治全部所需游戏币 */
  clinicCost: number;
  /** 自愈所需属性回升阈值 */
  selfHealStat: number;
  /** 自愈需维持的小时数 */
  selfHealHours: number;
}

// ------------------------------------------------------------------ 默认值

const DEFAULT_RATES: PetRates = {
  hunger: 5,
  cleanliness: 3,
  moodBase: 2,
  moodStarving: 3,
  stamina: 10,
};

const DEFAULT_GROWTH: PetGrowth = { baseExp: 100, ratio: 1.2, maxLevel: 100 };

const DEFAULT_ATTRS: PetAttrs = {
  staminaMaxBase: 100,
  staminaMaxPerLevel: 2,
  speedBase: 10,
  speedPerLevel: 1.0,
  enduranceBase: 10,
  endurancePerLevel: 0.8,
};

const DEFAULT_STAGES: PetStage[] = [
  { key: 'baby', maxLevel: 5 },
  { key: 'teen', maxLevel: 15 },
  { key: 'adult', maxLevel: DEFAULT_GROWTH.maxLevel },
];

const DEFAULT_ACTIONS: Record<PetActionKey, PetActionConfig> = {
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

const DEFAULT_DAILY_CAP: PetDailyCap = { intimacy: 100, exp: 200, coin: 500 };

const DEFAULT_OFFLINE: PetOffline = {
  coinPerHour: 10,
  maxHours: 8,
  perLevelBonus: 0.05,
};

const DEFAULT_COMFORT: PetComfort = { factorCap: 0.3, max: 100 };

const DEFAULT_TRAITS: PetTraitDef[] = [
  {
    key: 'lively',
    name: '活泼',
    desc: '陪玩收益提升',
    weight: 10,
    effects: { playGain: 0.15 },
  },
  {
    key: 'timid',
    name: '胆小',
    desc: '心情衰减更快',
    weight: 10,
    effects: { moodDecay: 0.2 },
  },
  {
    key: 'greedy',
    name: '贪吃',
    desc: '喂食收益提升，但更易饿',
    weight: 10,
    effects: { feedGain: 0.2, hungerDecay: 0.15 },
  },
  {
    key: 'aloof',
    name: '高冷',
    desc: '抚摸收益下降',
    weight: 8,
    effects: { petGain: -0.1 },
  },
  {
    key: 'clean',
    name: '爱干净',
    desc: '清洁衰减更慢',
    weight: 8,
    effects: { cleanDecay: -0.2 },
  },
  {
    key: 'sleepy',
    name: '嗜睡',
    desc: '体力恢复更快',
    weight: 8,
    effects: { staminaRecover: 0.2 },
  },
];

const DEFAULT_CONDITIONS: PetConditionDef[] = [
  {
    key: 'hungry_weak',
    name: '营养不良',
    desc: '饱食长期为 0 导致，离线时薪下降',
    source: 'hunger',
    thresholdHours: 12,
    effects: { offlineRate: -0.3 },
  },
  {
    key: 'dirty_flea',
    name: '跳蚤',
    desc: '清洁长期为 0 导致，亲密收益减半',
    source: 'cleanliness',
    thresholdHours: 12,
    effects: { intimacyGain: -0.5 },
  },
  {
    key: 'low_mood',
    name: '抑郁',
    desc: '心情长期为 0 导致，赛跑成绩下降',
    source: 'mood',
    thresholdHours: 24,
    effects: { raceScore: -0.1 },
  },
];

// ------------------------------------------------------------------ 校验规则

const statDelta = Joi.number().integer().min(-STAT_MAX).max(STAT_MAX);

/** 倍率增量：允许负（减益），上界 10 防误填。用于特质/病症 effects。 */
const traitRate = Joi.number().min(-1).max(10);

const actionSchema = strictObject({
  effects: strictObject({
    hunger: statDelta.optional(),
    cleanliness: statDelta.optional(),
    mood: statDelta.optional(),
    stamina: statDelta.optional(),
  }),
  // 冷却上限 24h：再长就等于永久禁用该动作，属于误填而非调参
  cooldownMs: nonNegInt.max(86_400_000).required(),
  gain: strictObject({
    intimacy: nonNegInt.required(),
    exp: nonNegInt.required(),
    coin: nonNegInt.required(),
  }),
});

// ------------------------------------------------------------------ 配置项

export const PET_CONFIG = {
  'pet.rates': defineConfig<PetRates>({
    description: '宠物状态每小时衰减/恢复速率',
    default: DEFAULT_RATES,
    // 速率必须非负：负数会让状态「自己长回来」，等于关掉了养成循环
    schema: strictObject({
      hunger: nonNegInt.required(),
      cleanliness: nonNegInt.required(),
      moodBase: nonNegInt.required(),
      moodStarving: nonNegInt.required(),
      stamina: nonNegInt.required(),
    }),
  }),

  'pet.growth': defineConfig<PetGrowth>({
    description: '升级经验曲线：baseExp 为 Lv1→2 所需，之后每级乘 ratio',
    default: DEFAULT_GROWTH,
    schema: strictObject({
      baseExp: posInt.required(),
      // ratio < 1 会让高等级所需经验递减，等级会瞬间冲顶
      ratio: Joi.number().min(1).max(10).required(),
      maxLevel: posInt.max(1000).required(),
    }),
  }),

  'pet.attrs': defineConfig<PetAttrs>({
    description: '三围属性成长（派生，不落库）：只由等级决定，装扮不加属性',
    default: DEFAULT_ATTRS,
    schema: strictObject({
      staminaMaxBase: posInt.required(),
      staminaMaxPerLevel: Joi.number().min(0).required(),
      speedBase: Joi.number().min(0).required(),
      speedPerLevel: Joi.number().min(0).required(),
      enduranceBase: Joi.number().min(0).required(),
      endurancePerLevel: Joi.number().min(0).required(),
    }),
  }),

  'pet.stages': defineConfig<PetStage[]>({
    description: '成长阶段（影响外观换模/进化演出），按 maxLevel 升序',
    default: DEFAULT_STAGES,
    schema: Joi.array()
      .min(1)
      .items(
        strictObject({
          key: Joi.string().max(16).required(),
          maxLevel: posInt.required(),
        }),
      )
      .required(),
  }),

  'pet.actions': defineConfig<Record<PetActionKey, PetActionConfig>>({
    description: '四种互动动作的状态增益、冷却与产出',
    default: DEFAULT_ACTIONS,
    // 四个动作都必须在：少一个会让对应接口直接 500
    schema: strictObject({
      feed: actionSchema,
      bath: actionSchema,
      pet: actionSchema,
      play: actionSchema,
    }),
  }),

  'pet.daily_cap': defineConfig<PetDailyCap>({
    description: '互动每日产出上限（账号级，多宠共享），防刷',
    default: DEFAULT_DAILY_CAP,
    schema: strictObject({
      intimacy: nonNegInt.required(),
      exp: nonNegInt.required(),
      coin: nonNegInt.required(),
    }),
  }),

  'pet.max_pets_per_user': defineConfig<number>({
    description: '每个玩家最多可养宠物数',
    default: 6,
    // 上限 100：再大就该考虑分页与性能，不是调参能覆盖的
    schema: posInt.max(100).required(),
  }),

  'pet.offline': defineConfig<PetOffline>({
    description: '离线收益：时薪、封顶小时数、出战宠每级加成',
    default: DEFAULT_OFFLINE,
    schema: strictObject({
      coinPerHour: nonNegInt.required(),
      // 封顶必须 >0，否则离线收益恒为 0
      maxHours: Joi.number().min(0).max(720).required(),
      perLevelBonus: Joi.number().min(0).max(10).required(),
    }),
  }),

  'pet.comfort': defineConfig<PetComfort>({
    description: '家园舒适度对心情衰减的减免：factorCap 为减免上限',
    default: DEFAULT_COMFORT,
    schema: strictObject({
      // 减免达到 1 会让心情永不衰减
      factorCap: Joi.number().min(0).max(0.9).required(),
      max: posInt.required(),
    }),
  }),

  'pet.traits': defineConfig<PetTraitDef[]>({
    description:
      '性格特质目录：出生随机分配 trait_count 个，终身不变。effects 只作用于收益与衰减，绝不碰 speed/endurance',
    default: DEFAULT_TRAITS,
    schema: Joi.array()
      .items(
        strictObject({
          key: Joi.string().max(24).required(),
          name: Joi.string().max(16).required(),
          desc: Joi.string().max(64).required(),
          weight: posInt.required(),
          effects: strictObject({
            feedGain: traitRate.optional(),
            petGain: traitRate.optional(),
            playGain: traitRate.optional(),
            hungerDecay: traitRate.optional(),
            cleanDecay: traitRate.optional(),
            moodDecay: traitRate.optional(),
            staminaRecover: traitRate.optional(),
          }),
        }),
      )
      .required(),
  }),

  'pet.trait_count': defineConfig<PetTraitCount>({
    description: '出生随机分配的特质数量区间（含端点）',
    default: { min: 1, max: 2 },
    schema: strictObject({
      min: nonNegInt.max(10).required(),
      max: posInt.max(10).required(),
    }),
  }),

  'pet.conditions': defineConfig<PetConditionDef[]>({
    description:
      '病症目录：source 指定观察哪个属性，归零满 thresholdHours 即触发。effects 只降收益',
    default: DEFAULT_CONDITIONS,
    schema: Joi.array()
      .items(
        strictObject({
          key: Joi.string().max(32).required(),
          name: Joi.string().max(16).required(),
          desc: Joi.string().max(64).required(),
          source: Joi.string()
            .valid('hunger', 'cleanliness', 'mood')
            .required(),
          thresholdHours: posInt.max(8760).required(),
          effects: strictObject({
            offlineRate: traitRate.optional(),
            intimacyGain: traitRate.optional(),
            raceScore: traitRate.optional(),
          }),
        }),
      )
      .required(),
  }),

  'pet.cure': defineConfig<PetCureConfig>({
    description:
      '治疗方式：用药消耗道具治一种，看诊花币治全部，自愈需属性回升并维持',
    default: {
      itemKey: 'cons_medicine',
      clinicCost: 200,
      selfHealStat: 60,
      selfHealHours: 6,
    },
    schema: strictObject({
      itemKey: Joi.string().max(48).required(),
      clinicCost: nonNegInt.max(1_000_000).required(),
      selfHealStat: nonNegInt.max(100).required(),
      selfHealHours: posInt.max(8760).required(),
    }),
  }),
};

export type PetConfigShape = ShapeOf<typeof PET_CONFIG>;

// ------------------------------------------------------------------ 纯函数

/**
 * 由家园舒适度换算心情衰减减免系数（0 ~ factorCap）。
 * 取配置作为显式入参，保持纯函数：便于单测，也避免隐式读全局状态。
 */
export function comfortFactorOf(comfort: number, cfg: PetComfort): number {
  const raw = Math.max(0, comfort) / cfg.max;
  return Math.min(raw, cfg.factorCap);
}
