/**
 * 小游戏赚币（P11）可调数值。
 *
 * 只有「记忆翻牌」一款，这是刻意的：服务端权威要求服务端独占游戏内的隐藏信息，
 * 而翻牌是少数能低成本做到这一点的形态（牌面由 seed 推导、逐次 flip 揭示）。
 * 接飞盘、节奏喂食这类实时操作类无法在服务端低成本重放，只能靠「相信客户端上报」，
 * 那等于把刷币接口挂在公网上。要加新游戏，先回答「隐藏信息在服务端吗」。
 *
 * 单局收益上限是防校验被绕过的兜底，不是经济封顶。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  posInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface MinigameDef {
  key: string;
  name: string;
  /** 时长秒（0 = 不限时，实际由 `minigame.session.ttlSec` 兜住） */
  durationSec: number;
  /** 单局收益上限（防绕过） */
  maxRewardCoin: number;
  /** 多少分换 1 币 */
  scorePerCoin: number;
  /** 牌对数。牌位数 = pairs × 2 */
  pairs: number;
  /** 每配对成功一对得分 */
  scorePerPair: number;
  /**
   * 每次配对失败扣分。
   *
   * 必须存在：只按配对数给分的话，把每张牌都翻一遍再逐对翻开就是稳定满分，
   * 「记忆」这件事就不产生任何差异了。
   */
  missPenalty: number;
}

export interface MinigameSession {
  /** 对局有效期秒 */
  ttlSec: number;
  /** 单局最大操作数（DoS 面 + ArrayMaxSize 兜底） */
  maxActionsPerSession: number;
}

export const MINIGAME_CONFIG = {
  'minigame.games': defineConfig<MinigameDef[]>({
    description:
      '小游戏目录（当前只有记忆翻牌）。满分 = pairs × scorePerPair，据此与 scorePerCoin/maxRewardCoin 一起定收益天花板',
    default: [
      {
        key: 'memory',
        name: '记忆翻牌',
        durationSec: 0,
        maxRewardCoin: 60,
        scorePerCoin: 12,
        pairs: 8,
        scorePerPair: 100,
        missPenalty: 20,
      },
    ],
    schema: Joi.array()
      .min(1)
      .items(
        strictObject({
          key: Joi.string().max(32).required(),
          name: Joi.string().max(32).required(),
          durationSec: nonNegInt.max(86400).required(),
          maxRewardCoin: nonNegInt.max(1_000_000).required(),
          scorePerCoin: posInt.max(1_000_000).required(),
          // 牌位数 = pairs × 2，上限 32 对（64 张）够任何手机屏幕了
          pairs: posInt.min(2).max(32).required(),
          scorePerPair: posInt.max(1_000_000).required(),
          missPenalty: nonNegInt.max(1_000_000).required(),
        }),
      )
      .required(),
  }),

  'minigame.session': defineConfig<MinigameSession>({
    description: '对局有效期与单局最大操作数（防 DoS）',
    default: { ttlSec: 300, maxActionsPerSession: 2000 },
    schema: strictObject({
      ttlSec: posInt.max(86400).required(),
      maxActionsPerSession: posInt.max(100000).required(),
    }),
  }),
};

export type MinigameConfigShape = ShapeOf<typeof MINIGAME_CONFIG>;
