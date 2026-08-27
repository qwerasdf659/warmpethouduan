/**
 * 训练技巧（P13）可调数值。
 *
 * 解锁条件是「累计陪玩 N 次」，走新列 pet.play_count（daily 域的按日 Redis 键无法承载累计语义）。
 * 满熟练度的 raceScore 加成与 Petpet 走同一套 PetBonusService 聚合层。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

/** 满熟练度掌握加成（键与 Petpet/融合 bonus 同构）。 */
export interface TrickMasteryBonus {
  offlineRate?: number;
  expGain?: number;
  raceScore?: number;
  moodDecay?: number;
}

export interface TrickPerform {
  intimacy: number;
  coin: number;
}

export interface TrickDef {
  key: string;
  name: string;
  requireLevel: number;
  requirePlayCount: number;
  staminaCost: number;
  cooldownMs: number;
  /** 每次练习提升的熟练度 */
  proficiencyGain: number;
  /** 表演收益 */
  perform: TrickPerform;
  /** 满熟练度掌握加成（可选） */
  masteryBonus?: TrickMasteryBonus;
}

const bonusRate = Joi.number().min(-1).max(10);

export const TRAINING_CONFIG = {
  'training.tricks': defineConfig<TrickDef[]>({
    description:
      '技巧目录：解锁需等级与累计陪玩次数；表演收益不并入 pet.daily_cap',
    default: [
      {
        key: 'sit',
        name: '坐下',
        requireLevel: 1,
        requirePlayCount: 5,
        staminaCost: 5,
        cooldownMs: 60000,
        proficiencyGain: 8,
        perform: { intimacy: 3, coin: 8 },
      },
      {
        key: 'shake',
        name: '握手',
        requireLevel: 5,
        requirePlayCount: 10,
        staminaCost: 5,
        cooldownMs: 60000,
        proficiencyGain: 8,
        perform: { intimacy: 3, coin: 10 },
      },
      {
        key: 'roll',
        name: '打滚',
        requireLevel: 10,
        requirePlayCount: 15,
        staminaCost: 6,
        cooldownMs: 90000,
        proficiencyGain: 6,
        perform: { intimacy: 4, coin: 12 },
      },
      {
        key: 'jump',
        name: '跳圈',
        requireLevel: 20,
        requirePlayCount: 25,
        staminaCost: 8,
        cooldownMs: 120000,
        proficiencyGain: 5,
        perform: { intimacy: 5, coin: 15 },
        masteryBonus: { raceScore: 0.02 },
      },
      {
        key: 'dance',
        name: '跳舞',
        requireLevel: 30,
        requirePlayCount: 40,
        staminaCost: 10,
        cooldownMs: 180000,
        proficiencyGain: 4,
        perform: { intimacy: 6, coin: 20 },
      },
    ],
    schema: Joi.array()
      .items(
        strictObject({
          key: Joi.string().max(32).required(),
          name: Joi.string().max(16).required(),
          requireLevel: posInt.max(1000).required(),
          requirePlayCount: nonNegInt.max(1_000_000).required(),
          staminaCost: nonNegInt.max(100).required(),
          cooldownMs: nonNegInt.max(86_400_000).required(),
          proficiencyGain: posInt.max(100).required(),
          perform: strictObject({
            intimacy: nonNegInt.max(10000).required(),
            coin: nonNegInt.max(1_000_000).required(),
          }),
          masteryBonus: strictObject({
            offlineRate: bonusRate.optional(),
            expGain: bonusRate.optional(),
            raceScore: bonusRate.optional(),
            moodDecay: bonusRate.optional(),
          })
            .min(1)
            .optional(),
        }),
      )
      .required(),
  }),
};

export type TrainingConfigShape = ShapeOf<typeof TRAINING_CONFIG>;
