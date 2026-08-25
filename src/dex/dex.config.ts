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
 * 加来源必须同时改代码，故 schema 限定为已实现的三种。
 */
export type DexProgressType = 'maxLevel' | 'petCount' | 'maxIntimacy';

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
];

export const DEX_CONFIG = {
  'dex.entries': defineConfig<DexEntry[]>({
    description:
      '图鉴条目：进度来源限 maxLevel(最高等级)/petCount(宠物数)/maxIntimacy(最高亲密度)',
    default: DEFAULT_ENTRIES,
    schema: Joi.array()
      .min(1)
      .items(
        strictObject({
          key: Joi.string().max(32).required(),
          name: Joi.string().max(32).required(),
          desc: Joi.string().max(128).required(),
          type: Joi.string()
            .valid('maxLevel', 'petCount', 'maxIntimacy')
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
