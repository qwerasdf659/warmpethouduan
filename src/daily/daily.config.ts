/**
 * 签到与每日任务的可调数值。集中在此便于运营调参，
 * 后续迁 DB 配置表时只替换取值来源。
 */

/** 签到奖励：基础 + (连签天数-1)×步进，封顶 cap；发放至 game 池。 */
export const CHECKIN = {
  baseCoin: 20,
  streakStepCoin: 10,
  maxCoin: 100,
} as const;

/** 由连签天数推出当日签到奖励游戏币。 */
export function checkinRewardOf(streak: number): number {
  const n = Math.max(1, streak);
  return Math.min(
    CHECKIN.maxCoin,
    CHECKIN.baseCoin + (n - 1) * CHECKIN.streakStepCoin,
  );
}

export type DailyTaskKey = 'interact' | 'checkin' | 'play';

export interface DailyTaskConfig {
  key: DailyTaskKey;
  name: string;
  /** 完成所需进度 */
  target: number;
  /** 完成奖励游戏币 */
  coin: number;
  /**
   * 进度来源：
   *  - 'act'     当日互动总次数（Redis 计数器 act:{userId}:{day}）
   *  - 'play'    当日 play 次数（Redis 计数器 act:{userId}:{day}:play）
   *  - 'checkin' 是否已签到（0/1）
   */
  source: 'act' | 'play' | 'checkin';
}

export const DAILY_TASKS: DailyTaskConfig[] = [
  {
    key: 'checkin',
    name: '完成每日签到',
    target: 1,
    coin: 10,
    source: 'checkin',
  },
  {
    key: 'interact',
    name: '照顾宠物 5 次',
    target: 5,
    coin: 30,
    source: 'act',
  },
  {
    key: 'play',
    name: '陪玩 3 次',
    target: 3,
    coin: 20,
    source: 'play',
  },
];
