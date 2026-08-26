import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

/**
 * 一件消耗品的使用效果。全部可选，缺省即不影响该项。
 *
 * 只允许**非负**增益：消耗品是花钱买来的正向道具，负效果（下毒/惩罚）
 * 不在当前设计里，放开负数只会给运营留一个能把玩家宠物调坏的口子。
 */
export interface ConsumableEffect {
  hunger?: number;
  cleanliness?: number;
  mood?: number;
  stamina?: number;
  exp?: number;
}

/** itemKey -> 效果 */
export type ConsumableTable = Record<string, ConsumableEffect>;

const DEFAULT_CONSUMABLES: ConsumableTable = {
  cons_snack: { hunger: 25 },
  cons_bubble: { cleanliness: 30 },
  cons_toy: { mood: 20 },
  cons_energy: { stamina: 40 },
  cons_cake: { hunger: 20, mood: 25, exp: 30 },
};

/** 单项增益上界 100：状态值本身就是 0~100，给到 100 已是「一口喂满」。 */
const gain = Joi.number().integer().min(1).max(100);

export const ITEMS_CONFIG = {
  'items.consumables': defineConfig<ConsumableTable>({
    description:
      '消耗品使用效果（itemKey → 增益）。键必须与 asset_def 中 meta.itemType=consumable 的资产 code 一致',
    default: DEFAULT_CONSUMABLES,
    schema: Joi.object()
      .pattern(
        Joi.string().max(48),
        strictObject({
          hunger: gain.optional(),
          cleanliness: gain.optional(),
          mood: gain.optional(),
          stamina: gain.optional(),
          // 经验不受 0~100 约束，但也别给到能一口升十级
          exp: nonNegInt.max(10_000).optional(),
        }).min(1),
      )
      .required(),
  }),
};

export type ItemsConfigShape = ShapeOf<typeof ITEMS_CONFIG>;

/**
 * 效果是否为空（全部字段缺省）。
 *
 * 运营把某个消耗品的效果配成 `{}` 时，schema 的 `.min(1)` 会拦住写入，
 * 但**存量脏数据**和「asset_def 里加了消耗品却忘了配效果」这两种情况仍会漏到运行期，
 * 所以使用时还要再判一次。
 */
export function isEmptyEffect(e: ConsumableEffect | undefined): boolean {
  if (!e) return true;
  return (
    (e.hunger ?? 0) === 0 &&
    (e.cleanliness ?? 0) === 0 &&
    (e.mood ?? 0) === 0 &&
    (e.stamina ?? 0) === 0 &&
    (e.exp ?? 0) === 0
  );
}
