/**
 * 扭蛋配置。
 *
 * 扭蛋在经济里的角色是**无限 sink**：收藏品总有买断的一天，产出却每天都在，
 * 长期通胀必须靠可无限重复的消耗顶住（另一个是消耗品，见 `items.config.ts`）。
 * 因此单抽定价刻意高于日收入的三分之一，且**期望回收明显低于成本**。
 *
 * 合规提示：虚拟道具抽取需在客户端**公示概率**，`GET /gacha` 就是为此存在的
 * ——它返回每档的权重与换算后的百分比，前端必须展示。
 *
 * **扭蛋不产出货币**（决策 D1）。原因不是数值平衡，而是结构性的：`game_coin` 作为
 * 交易媒介必须 `tradable`，而 `tradable AND gacha_output` 被数据库 CHECK 禁止 ——
 * 「投入货币 → 随机 → 产出可自由变现的货币」正是开箱博彩的形状。因此产出侧只留
 * 道具与消耗品，且扭蛋限定款一律 `tradable = false`。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  type ShapeOf,
} from '../config/game-config.types';

export interface GachaEntry {
  key: string;
  name: string;
  /** 相对权重（不是百分比）。概率 = weight / sum(weight) */
  weight: number;
  /** 产出的 `asset_def.code`。**不能是货币**（D1，见 `GachaPrize` 注释） */
  itemKey: string;
  /** 件数 */
  qty: number;
  /** 稀有档：抽中时重置保底计数，前端可做特殊演出 */
  rare: boolean;
}

export interface GachaPool {
  key: string;
  name: string;
  pool: 'game' | 'marketing';
  /** 单抽价格 */
  cost: number;
  /** 十连价格（给折扣，通常 < cost×10） */
  costTen: number;
  /**
   * 保底抽数：连续这么多抽没出稀有，则**强制**出稀有档。
   * 0 = 不保底。
   */
  pity: number;
  /**
   * 重复收藏品的补偿道具（`asset_def.code`）。`null` = 不补偿。
   *
   * 旧实现折算成游戏币，D1 之后不能再这么做（扭蛋不产币）。补偿改为消耗品。
   *
   * 而且**只有不可交易的重复品才需要补偿**：唯一物品实例化之后，可交易皮肤的
   * 第二份是有价值的资产（可以挂到市场卖掉），再塞一份就是正当产出。
   * 真正的零价值情形只剩「重复的、且不可交易的」那部分 —— 也就是扭蛋限定款。
   */
  dupeItemKey: string | null;
  /** 补偿道具的件数 */
  dupeQty: number;
  entries: GachaEntry[];
}

const DEFAULT_POOLS: GachaPool[] = [
  {
    key: 'daily',
    name: '日常扭蛋',
    pool: 'game',
    cost: 300,
    // 十连 2700 = 九折，且保底必出稀有，让「攒着十连」成为更优策略
    costTen: 2700,
    pity: 30,
    dupeItemKey: 'cons_snack',
    dupeQty: 2,
    /*
     * 权重合计 1000。
     *
     * D1 之前有两档「零钱」（60 币 420‰、200 币 260‰）占去 68% 的权重，移除后
     * 那部分权重必须有去处，否则奖池的期望回收会失真。这里把它们并入消耗品档：
     * 消耗品同样是「用得掉、不积累」的产出，经济学作用与小额零钱一致
     * （都不会变成可无限累积的购买力），因此扭蛋作为 sink 的定位不变。
     *
     * 期望回收按币值折算约 205 币/抽（零食 60×0.42 + 泡泡 60×0.26 + 能量饮 120×0.09
     * + 蛋糕 300×0.06 + 稀有背景/皮肤按售价 1200/2200 折 0.02/0.01），
     * 仍明显低于 300 的单抽成本 —— 这是它能当 sink 的前提。
     */
    entries: [
      {
        key: 'snack',
        name: '宠物零食 ×3',
        weight: 420,
        itemKey: 'cons_snack',
        qty: 3,
        rare: false,
      },
      {
        key: 'bubble',
        name: '清洁泡泡 ×3',
        weight: 260,
        itemKey: 'cons_bubble',
        qty: 3,
        rare: false,
      },
      {
        key: 'energy',
        name: '能量饮 ×2',
        weight: 140,
        itemKey: 'cons_energy',
        qty: 2,
        rare: false,
      },
      {
        key: 'cake',
        name: '生日蛋糕 ×1',
        weight: 150,
        itemKey: 'cons_cake',
        qty: 1,
        rare: false,
      },
      {
        key: 'bg_beach',
        name: '海边夕照（背景）',
        weight: 20,
        itemKey: 'bg_beach',
        qty: 1,
        rare: true,
      },
      {
        key: 'skin_shadow',
        name: '玄影（皮肤）',
        weight: 10,
        itemKey: 'skin_shadow',
        qty: 1,
        rare: true,
      },
    ],
  },
];

/**
 * 档位 schema。
 *
 * D1 之前这里是一组 `Joi.alternatives()`，因为 `kind='coin'` 与 `kind='item'` 的
 * 字段要求互斥（币档必须 `itemKey=null`、物品档必须有 `itemKey`）。移除币档之后
 * 只剩一种形态，schema 随之退化成一个普通 object —— 少一个分支就少一处能配错的地方。
 */
const entrySchema = Joi.object({
  key: Joi.string().max(48).required(),
  name: Joi.string().max(64).required(),
  // 零权重的档位永远抽不到，是配置错误而非「临时关掉」的手段
  weight: posInt.max(1_000_000).required(),
  rare: Joi.boolean().required(),
  itemKey: Joi.string().max(48).required(),
  qty: posInt.max(999).required(),
}).unknown(false);

export const GACHA_CONFIG = {
  'gacha.pools': defineConfig<GachaPool[]>({
    description:
      '扭蛋奖池：权重、单抽/十连价格、保底抽数、重复收藏品的补偿道具。产出只有道具与消耗品（不产币），概率由权重实时换算并对外公示',
    default: DEFAULT_POOLS,
    schema: Joi.array()
      .items(
        // 刻意不用 strictObject：它带 `.required()`，会让数组不能为空。
        // 扭蛋是唯一有合规敞口的玩法，必须留一个「清空即全量下架」的开关，
        // 且不需要发版。字段级的严格性由下面各自的 required 保证。
        Joi.object({
          key: Joi.string().max(48).required(),
          name: Joi.string().max(48).required(),
          pool: Joi.string().valid('game', 'marketing').required(),
          cost: posInt.max(1_000_000).required(),
          costTen: posInt.max(10_000_000).required(),
          pity: nonNegInt.max(1000).required(),
          dupeItemKey: Joi.string().max(48).allow(null).required(),
          dupeQty: nonNegInt.max(999).required(),
          // 至少一档，否则这个池抽出来什么都没有
          entries: Joi.array().items(entrySchema).min(1).required(),
        }).unknown(false),
      )
      .required(),
  }),
};

export type GachaConfigShape = ShapeOf<typeof GACHA_CONFIG>;

// ------------------------------------------------------------------ 纯函数

export function getGachaPool(
  pools: GachaPool[],
  key: string,
): GachaPool | undefined {
  return pools.find((p) => p.key === key);
}

/** 权重合计。 */
export function totalWeight(entries: GachaEntry[]): number {
  return entries.reduce((a, e) => a + e.weight, 0);
}

/**
 * 按权重抽一档。`rand` 取 [0,1)，可注入以便测试。
 *
 * 用「累加到超过阈值」而非取模：权重是任意正整数，取模会让靠前的档位
 * 被系统性地多抽到（模偏差）。
 */
export function pickEntry(
  entries: GachaEntry[],
  rand: () => number,
): GachaEntry {
  const total = totalWeight(entries);
  let threshold = rand() * total;
  for (const e of entries) {
    threshold -= e.weight;
    if (threshold < 0) return e;
  }
  // 浮点累加误差导致走到这里时兜最后一档，而不是返回 undefined
  return entries[entries.length - 1];
}

/** 只在稀有档里抽（保底触发时用）。没有稀有档则返回 null。 */
export function pickRareEntry(
  entries: GachaEntry[],
  rand: () => number,
): GachaEntry | null {
  const rares = entries.filter((e) => e.rare);
  if (rares.length === 0) return null;
  return pickEntry(rares, rand);
}

/** 对外公示用：每档概率（百分比，保留 4 位小数）。 */
export function probabilityTable(
  entries: GachaEntry[],
): { key: string; name: string; rare: boolean; percent: number }[] {
  const total = totalWeight(entries);
  return entries.map((e) => ({
    key: e.key,
    name: e.name,
    rare: e.rare,
    percent: Math.round((e.weight / total) * 1_000_000) / 10_000,
  }));
}
