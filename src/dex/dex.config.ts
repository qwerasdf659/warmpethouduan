/**
 * 图鉴条目配置。解锁进度由玩家实际养成实时推导（不落库），
 * 达标后可领取一次性游戏币奖励（dex_claim 记录已领取）。
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
 * 进度来源。**结构性**取值：每个值对应一条具体的推导实现，
 * 加来源必须同时改代码，故 schema 只放已实现的这几种。
 *
 * 养成类（`maxLevel`/`petCount`/`maxIntimacy`）看 `pet` 表；
 * 收集类（`ownedSkin`/`ownedAccessory`/`ownedFurniture`/`ownedAll`）看持有的
 * **种类数**（同一件买多份不重复计数），由 `InventoryService.ownedKindCount`
 * 跨 `item_instance`（唯一物品）与 `asset_balance`（可堆叠）合并统计。
 */
export type DexProgressType =
  | 'maxLevel'
  | 'petCount'
  | 'maxIntimacy'
  | 'ownedSkin'
  | 'ownedAccessory'
  | 'ownedFurniture'
  | 'ownedAll';

export const DEX_PROGRESS_TYPES: DexProgressType[] = [
  'maxLevel',
  'petCount',
  'maxIntimacy',
  'ownedSkin',
  'ownedAccessory',
  'ownedFurniture',
  'ownedAll',
];

/** 收集类进度对应的物品类型（`ownedAll` 为跨类型合计）。 */
export const COLLECT_TYPE_OF: Partial<Record<DexProgressType, string>> = {
  ownedSkin: 'skin',
  ownedAccessory: 'accessory',
  ownedFurniture: 'furniture',
};

/**
 * `ownedAll` 计入的物品类型白名单。
 *
 * 用白名单而不是「把 `ownedKindCount` 的结果全加起来」：消耗品也会被统计到，
 * 但它是买了就用掉的日常道具，不是收藏品 —— 全加的话「收集 10 种」买几种零食
 * 就凑满了，而且用光后种类数还会掉回去，出现「图鉴进度倒退」这种解释不清的现象。
 */
export const COLLECTIBLE_TYPES: string[] = Object.values(COLLECT_TYPE_OF);

export interface DexEntry {
  key: string;
  name: string;
  desc: string;
  type: DexProgressType;
  target: number;
  /** 解锁奖励（游戏币） */
  reward: number;
  sortOrder: number;
}

const DEFAULT_ENTRIES: DexEntry[] = [
  {
    key: 'lv5',
    name: '初长成',
    desc: '任意宠物达到 5 级',
    type: 'maxLevel',
    target: 5,
    reward: 50,
    sortOrder: 1,
  },
  {
    key: 'lv15',
    name: '风华正茂',
    desc: '任意宠物达到 15 级',
    type: 'maxLevel',
    target: 15,
    reward: 150,
    sortOrder: 2,
  },
  {
    key: 'lv30',
    name: '独当一面',
    desc: '任意宠物达到 30 级',
    type: 'maxLevel',
    target: 30,
    reward: 400,
    sortOrder: 3,
  },
  {
    key: 'pet3',
    name: '热闹家庭',
    desc: '同时拥有 3 只宠物',
    type: 'petCount',
    target: 3,
    reward: 100,
    sortOrder: 10,
  },
  {
    key: 'pet6',
    name: '宠物大亨',
    desc: '同时拥有 6 只宠物',
    type: 'petCount',
    target: 6,
    reward: 300,
    sortOrder: 11,
  },
  {
    key: 'intimacy100',
    name: '亲密无间',
    desc: '任意宠物亲密度达 100',
    type: 'maxIntimacy',
    target: 100,
    reward: 120,
    sortOrder: 20,
  },
  {
    key: 'skin3',
    name: '衣橱初成',
    desc: '收集 3 种皮肤',
    type: 'ownedSkin',
    target: 3,
    reward: 120,
    sortOrder: 30,
  },
  {
    key: 'acc3',
    name: '配饰收藏家',
    desc: '收集 3 种配饰',
    type: 'ownedAccessory',
    target: 3,
    reward: 120,
    sortOrder: 31,
  },
  {
    key: 'furn4',
    name: '安乐窝',
    desc: '收集 4 种家具',
    type: 'ownedFurniture',
    target: 4,
    reward: 200,
    sortOrder: 32,
  },
  {
    key: 'collect10',
    name: '博物学家',
    desc: '累计收集 10 种物品',
    type: 'ownedAll',
    target: 10,
    reward: 400,
    sortOrder: 40,
  },
];

export const DEX_CONFIG = {
  'dex.entries': defineConfig<DexEntry[]>({
    description:
      '图鉴条目：养成类 maxLevel/petCount/maxIntimacy，收集类 ownedSkin/ownedAccessory/ownedFurniture/ownedAll（按种类数）',
    default: DEFAULT_ENTRIES,
    schema: Joi.array()
      .min(1)
      .items(
        strictObject({
          key: Joi.string().max(32).required(),
          name: Joi.string().max(32).required(),
          desc: Joi.string().max(128).required(),
          type: Joi.string()
            .valid(...DEX_PROGRESS_TYPES)
            .required(),
          target: posInt.required(),
          reward: nonNegInt.required(),
          sortOrder: nonNegInt.required(),
        }),
      )
      .required(),
  }),
};

export type DexConfigShape = ShapeOf<typeof DEX_CONFIG>;

export function getDexEntry(
  entries: DexEntry[],
  key: string,
): DexEntry | undefined {
  return entries.find((e) => e.key === key);
}
