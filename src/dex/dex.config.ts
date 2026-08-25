/**
 * 图鉴条目配置。解锁进度由玩家实际养成实时推导（不落库），
 * 达标后可领取一次性游戏币奖励（dex_claim 记录已领取）。
 */
export interface DexEntry {
  key: string;
  name: string;
  desc: string;
  /** 进度来源：maxLevel 最高等级 | petCount 拥有宠物数 | maxIntimacy 最高亲密度 */
  type: 'maxLevel' | 'petCount' | 'maxIntimacy';
  target: number;
  /** 解锁奖励（游戏币） */
  reward: number;
  sortOrder: number;
}

export const DEX_ENTRIES: DexEntry[] = [
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

export function getDexEntry(key: string): DexEntry | undefined {
  return DEX_ENTRIES.find((e) => e.key === key);
}
