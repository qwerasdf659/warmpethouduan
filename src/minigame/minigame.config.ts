/**
 * 小游戏赚币（P11）可调数值。
 *
 * 服务端下发 seed，settle 提交操作序列后用同一 seed 回放算分——客户端分数一律不采信。
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
  /** 时长秒（0 = 无时限，如翻牌） */
  durationSec: number;
  /** 单局收益上限（防绕过） */
  maxRewardCoin: number;
  /** 多少分换 1 币 */
  scorePerCoin: number;
}

export interface MinigameSession {
  /** 对局有效期秒 */
  ttlSec: number;
  /** 单局最大操作数（DoS 面 + ArrayMaxSize 兜底） */
  maxActionsPerSession: number;
}

export const MINIGAME_CONFIG = {
  'minigame.games': defineConfig<MinigameDef[]>({
    description: '小游戏目录：单局收益上限是防校验被绕过的兜底，不是经济封顶',
    default: [
      {
        key: 'catch',
        name: '接飞盘',
        durationSec: 60,
        maxRewardCoin: 80,
        scorePerCoin: 10,
      },
      {
        key: 'memory',
        name: '记忆翻牌',
        durationSec: 0,
        maxRewardCoin: 60,
        scorePerCoin: 12,
      },
      {
        key: 'rhythm',
        name: '节奏喂食',
        durationSec: 45,
        maxRewardCoin: 70,
        scorePerCoin: 10,
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
