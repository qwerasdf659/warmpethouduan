/**
 * 扭蛋配置。
 *
 * 扭蛋在经济里的角色是**无限 sink**：收藏品总有买断的一天，产出却每天都在，
 * 长期通胀必须靠可无限重复的消耗顶住（另一个是消耗品，见 `items.config.ts`）。
 * 因此单抽定价刻意高于日收入的三分之一，且**期望回收明显低于成本**。
 *
 * 合规提示：虚拟道具抽取需在客户端**公示概率**，`GET /gacha` 就是为此存在的
 * ——它返回每档的权重与换算后的百分比，前端必须展示。
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
  kind: 'coin' | 'item';
  /** kind='coin' 时的币量 */
  amount: number;
  /** kind='item' 时的 item_def.key */
  itemKey: string | null;
  /** kind='item' 时的件数 */
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
   * 重复收藏品的折算币量。
   *
   * 抽到已拥有的皮肤/配饰时给币而不是再塞一份：外观类第二份对玩家零价值，
   * 「抽了半天全是重复」是抽奖体验最容易崩的地方。家具不算重复（可以摆多份）。
   */
  dupeCoin: number;
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
    dupeCoin: 120,
    entries: [
      // 权重合计 1000。期望回收（不含稀有物品的观赏价值）约 210 币/抽，
      // 低于 300 的成本 —— 这是它能当 sink 的前提。
      {
        key: 'coin_small',
        name: '零钱 60',
        weight: 420,
        kind: 'coin',
        amount: 60,
        itemKey: null,
        qty: 0,
        rare: false,
      },
      {
        key: 'coin_mid',
        name: '零钱 200',
        weight: 260,
        kind: 'coin',
        amount: 200,
        itemKey: null,
        qty: 0,
        rare: false,
      },
      {
        key: 'snack',
        name: '宠物零食 ×3',
        weight: 140,
        kind: 'item',
        amount: 0,
        itemKey: 'cons_snack',
        qty: 3,
        rare: false,
      },
      {
        key: 'energy',
        name: '能量饮 ×2',
        weight: 90,
        kind: 'item',
        amount: 0,
        itemKey: 'cons_energy',
        qty: 2,
        rare: false,
      },
      {
        key: 'cake',
        name: '生日蛋糕 ×1',
        weight: 60,
        kind: 'item',
        amount: 0,
        itemKey: 'cons_cake',
        qty: 1,
        rare: false,
      },
      {
        key: 'bg_beach',
        name: '海边夕照（背景）',
        weight: 20,
        kind: 'item',
        amount: 0,
        itemKey: 'bg_beach',
        qty: 1,
        rare: true,
      },
      {
        key: 'skin_shadow',
        name: '玄影（皮肤）',
        weight: 10,
        kind: 'item',
        amount: 0,
        itemKey: 'skin_shadow',
        qty: 1,
        rare: true,
      },
    ],
  },
];

const entryCommon = {
  key: Joi.string().max(48).required(),
  name: Joi.string().max(64).required(),
  // 零权重的档位永远抽不到，是配置错误而非「临时关掉」的手段
  weight: posInt.max(1_000_000).required(),
  rare: Joi.boolean().required(),
};

/**
 * `kind` 与 `amount`/`itemKey` 必须自洽，所以用 alternatives 分成两种形态，
 * 而不是一份 schema 加 `when`：后者做的是 schema 合并，基础声明里的
 * `allow(null)` 会被带进分支，于是「kind=item 但 itemKey=null」照样通过。
 */
const entrySchema = Joi.alternatives()
  .try(
    Joi.object({
      ...entryCommon,
      kind: Joi.string().valid('coin').required(),
      amount: posInt.max(1_000_000).required(),
      itemKey: Joi.valid(null).required(),
      qty: Joi.valid(0).required(),
    }).unknown(false),
    Joi.object({
      ...entryCommon,
      kind: Joi.string().valid('item').required(),
      amount: Joi.valid(0).required(),
      itemKey: Joi.string().max(48).required(),
      qty: posInt.max(999).required(),
    }).unknown(false),
  )
  .match('one');

export const GACHA_CONFIG = {
  'gacha.pools': defineConfig<GachaPool[]>({
    description:
      '扭蛋奖池：权重、单抽/十连价格、保底抽数、重复收藏品折算币量。概率由权重实时换算并对外公示',
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
          dupeCoin: nonNegInt.max(1_000_000).required(),
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
