import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { RewardService } from '../ledger/reward.service';
import { GAME_COIN } from '../ledger/ledger.types';
import { MinigameSession } from '../entities/minigame-session.entity';
import { EventProgressService } from '../event/event-progress.service';
import type { MinigameDef } from './minigame.config';

export interface MinigameListItem {
  key: string;
  name: string;
  durationSec: number;
  maxRewardCoin: number;
  /** 牌位数（= pairs × 2），客户端据此渲染牌面网格 */
  boardSize: number;
}

export interface MinigameSessionView {
  id: string;
  /** 牌位数。牌面本身不下发 */
  boardSize: number;
  expiresAt: string;
  remainSec: number;
  matched: number[];
  attempts: number;
}

export interface MinigameFlipView {
  /** 本次翻开的牌位与它的花色 */
  index: number;
  face: number;
  /** 本轮第一张（本次是本轮第一张时为 null） */
  firstIndex: number | null;
  firstFace: number | null;
  /** 本轮是否凑成一对（本次只是第一张时为 null） */
  matched: boolean | null;
  /** 已配对的牌位（服务端记账，客户端不必自己维护） */
  matchedIndices: number[];
  attempts: number;
  /** 全部配对完成 */
  finished: boolean;
}

/**
 * 小游戏赚币（P11）：记忆翻牌。
 *
 * 服务端权威在这里的含义是**服务端独占隐藏信息**：牌面由 `seed` 确定性推导、
 * 从不下发，玩家每次 `flip` 由服务端揭示一张并把进度记进 `session.state`，
 * `settle` 完全按服务端自己记的进度算分。客户端不提交任何过程数据，
 * 因此没有「上报分数」这回事，也就没有可篡改的面。
 *
 * 单局收益上限（`maxRewardCoin`）仍然保留：它防的不是算分被绕过，
 * 而是配置被改错（比如把 `scorePerCoin` 设成 1）。
 */
@Injectable()
export class MinigameService {
  constructor(
    @InjectRepository(MinigameSession)
    private readonly sessions: Repository<MinigameSession>,
    private readonly reward: RewardService,
    private readonly economy: EconomyService,
    private readonly lock: LockService,
    private readonly clock: ClockService,
    private readonly config: GameConfigService,
    private readonly eventProgress: EventProgressService,
  ) {}

  /** 小游戏目录（scorePerCoin / missPenalty 不下发，避免玩家逆推刷分口径）。 */
  async list(): Promise<{ list: MinigameListItem[]; total: number }> {
    const games = await this.config.get('minigame.games');
    const listData = games.map((g) => ({
      key: g.key,
      name: g.name,
      durationSec: g.durationSec,
      maxRewardCoin: g.maxRewardCoin,
      boardSize: g.pairs * 2,
    }));
    return { list: listData, total: listData.length };
  }

  /** 开局：校验 gameKey，下发 seed 与有效期，落 open 态对局。 */
  async start(
    userId: string,
    gameKey: string,
    bizId: string,
  ): Promise<{ session: MinigameSessionView; duplicated: boolean }> {
    const games = await this.config.get('minigame.games');
    if (!games.some((g) => g.key === gameKey)) {
      throw new BadRequestException('小游戏不存在');
    }
    const { ttlSec } = await this.config.get('minigame.session');

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + ttlSec * 1000);

    try {
      const saved = await this.sessions.save(
        this.sessions.create({
          userId,
          gameKey,
          seed: randomBytes(32).toString('hex'),
          startedAt: now,
          expiresAt,
          status: 'open',
          state: { matched: [], attempts: 0, pending: null },
          score: null,
          rewardCoin: 0,
          bizId,
          settledAt: null,
        }),
      );
      return {
        session: await this.toSessionView(saved, now),
        duplicated: false,
      };
    } catch (err) {
      // 弱网重试撞上唯一键（userId+bizId）：回放已存在的对局，不再新开一局。
      // Redis 请求级去重通常先挡住，这里是持久兜底。
      if (err instanceof QueryFailedError) {
        const existing = await this.sessions.findOne({
          where: { userId, bizId },
        });
        if (existing) {
          return {
            session: await this.toSessionView(existing, this.clock.now()),
            duplicated: true,
          };
        }
      }
      throw err;
    }
  }

  /**
   * 翻一张牌。服务端揭示花色并推进对局状态。
   *
   * 同一玩家串行化：两个并发 flip 会各读到 `pending=null`、各自把自己记成
   * 「本轮第一张」，于是一轮翻了三张牌。锁的粒度是玩家而不是对局，
   * 因为一个玩家同时只该有一局在玩。
   */
  async flip(
    userId: string,
    sessionId: string,
    index: number,
  ): Promise<MinigameFlipView> {
    return this.lock.withLock(`minigame:${userId}`, async () => {
      const session = await this.loadOpenSession(userId, sessionId);
      const def = await this.defOf(session.gameKey);
      const board = this.boardOf(session.seed, def.pairs);

      if (!Number.isInteger(index) || index < 0 || index >= board.length) {
        throw new BadRequestException('牌位下标越界');
      }
      const state = session.state;
      if (state.matched.includes(index)) {
        throw new BadRequestException('该牌已配对');
      }
      if (state.pending === index) {
        throw new BadRequestException('同一张牌不能连翻两次');
      }

      const face = board[index];
      let view: MinigameFlipView;

      if (state.pending === null) {
        state.pending = index;
        view = {
          index,
          face,
          firstIndex: null,
          firstFace: null,
          matched: null,
          matchedIndices: [...state.matched],
          attempts: state.attempts,
          finished: false,
        };
      } else {
        const first = state.pending;
        const isMatch = board[first] === face;
        state.pending = null;
        state.attempts += 1;
        if (isMatch) state.matched.push(first, index);
        view = {
          index,
          face,
          firstIndex: first,
          firstFace: board[first],
          matched: isMatch,
          matchedIndices: [...state.matched],
          attempts: state.attempts,
          finished: state.matched.length === board.length,
        };
      }

      session.state = state;
      await this.sessions.save(session);
      return view;
    });
  }

  /**
   * 结算：按**服务端记录的**对局进度算分、发币、落 settled 态。
   *
   * 不接受任何客户端参数（除了 sessionId）：分数完全由 `session.state` 派生，
   * 所以「上报分数」这个攻击面不存在。
   */
  async settle(
    userId: string,
    sessionId: string,
  ): Promise<{
    score: number;
    rewardCoin: number;
    matchedPairs: number;
    attempts: number;
    wallet: WalletView;
    duplicated: boolean;
  }> {
    return this.lock.withLock(`minigame:${userId}`, async () => {
      const session = await this.loadOpenSession(userId, sessionId);
      const def = await this.defOf(session.gameKey);
      const now = this.clock.now();

      const matchedPairs = Math.floor(session.state.matched.length / 2);
      const misses = Math.max(0, session.state.attempts - matchedPairs);
      const score = Math.max(
        0,
        matchedPairs * def.scorePerPair - misses * def.missPenalty,
      );
      const rewardCoin = Math.min(
        Math.floor(score / def.scorePerCoin),
        def.maxRewardCoin,
      );

      let duplicated = false;
      if (rewardCoin > 0) {
        const result = await this.reward.grant(
          userId,
          [{ assetCode: GAME_COIN, count: rewardCoin }],
          {
            reason: 'minigame',
            // 持久幂等键按对局 id：同一局无论重试多少次只发一次币。
            bizKey: `minigame:settle:${session.id}`,
            refType: 'minigame_session',
            refId: session.id,
          },
        );
        duplicated = result.duplicated;
      }

      session.score = score;
      session.rewardCoin = rewardCoin;
      session.status = 'settled';
      session.settledAt = now;
      await this.sessions.save(session);

      // P12 活动任务进度：小游戏来源（软失败）
      await this.eventProgress.bump(userId, 'minigame');

      const wallet = await this.economy.getWallet(userId);
      return {
        score,
        rewardCoin,
        matchedPairs,
        attempts: session.state.attempts,
        wallet,
        duplicated,
      };
    });
  }

  // ---------------------------------------------------------------- 内部

  /** 取一局进行中的对局；已结算或已过期都在这里拦掉（过期顺带落终态）。 */
  private async loadOpenSession(
    userId: string,
    sessionId: string,
  ): Promise<MinigameSession> {
    const session = await this.sessions.findOne({
      where: { id: sessionId, userId },
    });
    if (!session) throw new BadRequestException('对局不存在');
    if (session.status !== 'open') {
      throw new BadRequestException('该对局已结束');
    }
    const now = this.clock.now();
    if (now.getTime() > session.expiresAt.getTime()) {
      session.status = 'expired';
      session.settledAt = now;
      await this.sessions.save(session);
      throw new BadRequestException('对局已过期');
    }
    return session;
  }

  private async defOf(gameKey: string): Promise<MinigameDef> {
    const games = await this.config.get('minigame.games');
    const def = games.find((g) => g.key === gameKey);
    if (!def) throw new BadRequestException('小游戏不存在');
    return def;
  }

  /**
   * 由 seed 确定性推导牌面（花色数组，下标即牌位）。
   *
   * 不落库正是为了让「服务端独占牌面」这件事没有第二个真相：
   * 同一个 seed 永远推出同一副牌，而 seed 是服务端随机生成、从不下发的。
   */
  private boardOf(seed: string, pairs: number): number[] {
    const faces: number[] = [];
    for (let i = 0; i < pairs; i += 1) faces.push(i, i);

    const rand = this.prng(seed);
    // Fisher-Yates：每个排列等概率。用有偏的洗法会让某些花色总在相邻牌位，
    // 玩家摸出规律之后这游戏就不用记了
    for (let i = faces.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [faces[i], faces[j]] = [faces[j], faces[i]];
    }
    return faces;
  }

  /**
   * xorshift32，由 seed 前 8 个十六进制字符起种。
   *
   * 不用 `Math.random()`：洗牌必须能从 seed 重现，否则每次读取牌面都是新的一副，
   * 玩家翻开的第一张和第二张会属于不同的牌局。
   */
  private prng(seed: string): () => number {
    let s = parseInt(seed.slice(0, 8), 16) || 0x9e3779b9;
    return () => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 0x1_0000_0000;
    };
  }

  private async toSessionView(
    session: MinigameSession,
    now: Date,
  ): Promise<MinigameSessionView> {
    const def = await this.defOf(session.gameKey);
    const remainMs = session.expiresAt.getTime() - now.getTime();
    return {
      id: session.id,
      // 只给牌位数，不给 seed：seed 能推出整副牌，下发等于把答案给客户端
      boardSize: def.pairs * 2,
      expiresAt: session.expiresAt.toISOString(),
      remainSec: Math.max(0, Math.ceil(remainMs / 1000)),
      matched: [...session.state.matched],
      attempts: session.state.attempts,
    };
  }
}
