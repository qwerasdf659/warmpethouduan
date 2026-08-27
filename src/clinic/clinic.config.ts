/**
 * 兽医经营（P7）可调数值。
 *
 * answer_key 落库但绝不下发；病例领取（GET /clinic/case）有意「读接口建行」，
 * 用 lock 串行化 + 「已有 open 病例则返回」使重复调用天然幂等。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface ClinicUnlock {
  cost: number;
}

export interface ClinicReward {
  /** 基础接诊币 */
  baseCoin: number;
  /** 答错折算比例 0~1 */
  wrongRatio: number;
  /** 病例有效期秒 */
  caseTtlSec: number;
  /** 星级正确率阈值（升序，长度即最高星级） */
  starThresholds: number[];
}

export const CLINIC_CONFIG = {
  'clinic.unlock': defineConfig<ClinicUnlock>({
    description: '诊所解锁花费（游戏币）',
    default: { cost: 5000 },
    schema: strictObject({
      cost: nonNegInt.max(10_000_000).required(),
    }),
  }),

  'clinic.reward': defineConfig<ClinicReward>({
    description: '接诊收益：基础币 × 星级系数，答错按 wrongRatio 折算',
    default: {
      baseCoin: 120,
      wrongRatio: 0.5,
      caseTtlSec: 600,
      starThresholds: [0, 0.6, 0.75, 0.85, 0.95],
    },
    schema: strictObject({
      baseCoin: nonNegInt.max(1_000_000).required(),
      wrongRatio: Joi.number().min(0).max(1).required(),
      caseTtlSec: posInt.max(86400).required(),
      starThresholds: Joi.array()
        .items(Joi.number().min(0).max(1))
        .min(1)
        .required(),
    }),
  }),
};

export type ClinicConfigShape = ShapeOf<typeof CLINIC_CONFIG>;
