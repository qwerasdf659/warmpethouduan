/**
 * 繁殖遗传（P3）可调数值。
 *
 * 遗传结果在**产蛋时**就算完并落库（见 BreedService）：孵化退化成纯建行，天然可重放。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface BreedRules {
  /** 双方须达到的成长阶段 key（对齐 pet.stages，不写死等级） */
  requireStage: string;
  /** 繁殖消耗游戏币 */
  costCoin: number;
  /** 双方各扣的体力 */
  staminaCost: number;
  /** 繁殖后冷却小时数 */
  cooldownHours: number;
  /** 孵化时长（小时） */
  hatchHours: number;
}

export interface BreedGenes {
  /** 皮肤基因显隐性顺序，越靠前越显性 */
  dominance: string[];
}

export interface BreedInherit {
  /** 体力上限加成基点（取父母均值比例） */
  staminaBonusBps: number;
  /** 体力上限加成上限基点 */
  staminaBonusCapBps: number;
  /** 特质继承概率 0~1 */
  traitInheritRate: number;
}

export interface BreedSpeedup {
  /** 加速每小时币价 */
  coinPerHour: number;
  /** 是否允许看广告加速 */
  adEnabled: boolean;
  /** 每次看广告加速的小时数 */
  adHours: number;
}

export const BREED_CONFIG = {
  'breed.rules': defineConfig<BreedRules>({
    description: '繁殖前提与消耗：双方须达 requireStage 阶段且不在冷却中',
    default: {
      requireStage: 'adult',
      costCoin: 500,
      staminaCost: 30,
      cooldownHours: 24,
      hatchHours: 4,
    },
    schema: strictObject({
      requireStage: Joi.string().max(16).required(),
      costCoin: nonNegInt.max(1_000_000).required(),
      staminaCost: nonNegInt.max(100).required(),
      cooldownHours: nonNegInt.max(8760).required(),
      hatchHours: nonNegInt.max(8760).required(),
    }),
  }),

  'breed.genes': defineConfig<BreedGenes>({
    description: '皮肤基因显隐性顺序，越靠前越显性。子代从父母各随机继承一个',
    default: {
      dominance: [
        'skin_default',
        'skin_snow',
        'skin_tiger',
        'skin_calico',
        'skin_shadow',
      ],
    },
    schema: strictObject({
      dominance: Joi.array().items(Joi.string().max(48)).min(1).required(),
    }),
  }),

  'breed.inherit': defineConfig<BreedInherit>({
    description: '属性与特质继承：体力上限加成取父母均值比例，特质继承概率',
    default: {
      staminaBonusBps: 1000,
      staminaBonusCapBps: 2000,
      traitInheritRate: 0.6,
    },
    schema: strictObject({
      staminaBonusBps: nonNegInt.max(10000).required(),
      staminaBonusCapBps: nonNegInt.max(10000).required(),
      traitInheritRate: Joi.number().min(0).max(1).required(),
    }),
  }),

  'breed.speedup': defineConfig<BreedSpeedup>({
    description: '孵化加速：每小时币价与是否允许看广告加速',
    default: { coinPerHour: 60, adEnabled: true, adHours: 1 },
    schema: strictObject({
      coinPerHour: nonNegInt.max(1_000_000).required(),
      adEnabled: Joi.boolean().required(),
      adHours: posInt.max(8760).required(),
    }),
  }),
};

export type BreedConfigShape = ShapeOf<typeof BREED_CONFIG>;
