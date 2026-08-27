/**
 * 融合（P8 后半）可调数值。
 *
 * 材料宠物用 status='fused' 软失效，不 DELETE（历史战报/血统追溯不断链）。
 * 形态加成与 Petpet 走同一套 PetBonusService 聚合层。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface FusionRecipeFrom {
  /** 材料形态 */
  form: string;
  /** 材料数量 */
  count: number;
  /** 是否要求同花色 */
  sameSkin: boolean;
  /** 材料须达到的成长阶段 key */
  requireStage: string;
}

export interface FusionRecipeTo {
  form: string;
  rarity: string;
}

export interface FusionRecipe {
  from: FusionRecipeFrom;
  to: FusionRecipeTo;
}

/** 形态被动加成（键与 Petpet bonus 同构）。 */
export interface FusionBonusEffect {
  offlineRate?: number;
  expGain?: number;
  raceScore?: number;
  moodDecay?: number;
}

export type FusionBonusTable = Record<string, FusionBonusEffect>;

const bonusRate = Joi.number().min(-1).max(10);

export const FUSION_CONFIG = {
  'fusion.recipes': defineConfig<FusionRecipe[]>({
    description:
      '融合配方：材料须同花色、同形态、达 requireStage；产出提升形态与稀有度',
    default: [
      {
        from: {
          form: 'normal',
          count: 3,
          sameSkin: true,
          requireStage: 'adult',
        },
        to: { form: 'glow', rarity: 'epic' },
      },
      {
        from: { form: 'glow', count: 3, sameSkin: true, requireStage: 'adult' },
        to: { form: 'rainbow', rarity: 'legendary' },
      },
    ],
    schema: Joi.array()
      .items(
        strictObject({
          from: strictObject({
            form: Joi.string().max(16).required(),
            count: posInt.max(100).required(),
            sameSkin: Joi.boolean().required(),
            requireStage: Joi.string().max(16).required(),
          }),
          to: strictObject({
            form: Joi.string().max(16).required(),
            rarity: Joi.string().max(24).required(),
          }),
        }),
      )
      .required(),
  }),

  'fusion.bonus': defineConfig<FusionBonusTable>({
    description: '融合形态的被动加成，与 Petpet 走同一套聚合层',
    default: {
      glow: { offlineRate: 0.1 },
      rainbow: { offlineRate: 0.25 },
    },
    schema: Joi.object()
      .pattern(
        Joi.string().max(16),
        strictObject({
          offlineRate: bonusRate.optional(),
          expGain: bonusRate.optional(),
          raceScore: bonusRate.optional(),
          moodDecay: bonusRate.optional(),
        }).min(1),
      )
      .required(),
  }),
};

export type FusionConfigShape = ShapeOf<typeof FUSION_CONFIG>;
