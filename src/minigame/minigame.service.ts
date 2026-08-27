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
import { MinigameActionDto } from './dto/minigame.dto';

export interface MinigameListItem {
  key: string;
  name: string;
  durationSec: number;
  maxRewardCoin: number;
}

export interface MinigameSessionView {
  id: string;
  seed: string;
  expiresAt: string;
  remainSec: number;
}

/**
 * 小游戏赚币（P11）。
 *
 * 服务端权威：`start` 下发 seed 并锁定有效期，`settle` 用同一 seed + 操作序列
 * 重算分数，客户端上报的分数一律不采信。单局收益上限是防校验被绕过的兜底。
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

  /** 小游戏目录（收益细节 scorePerCoin 不下发，避免玩家逆推刷分口径）。 */
  async list(): Promise<{ list: MinigameListItem[]; total: number }> {
    const games = await this.config.get('minigame.games');
    const listData = games.map((g) => ({
      key: g.key,
      name: g.name,
      durationSec: g.durationSec,
      maxRewardCoin: g.maxRewardCoin,
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
          score: null,
          rewardCoin: 0,
          bizId,
          settledAt: null,
        }),
      );
      return { session: this.toSessionView(saved, now), duplicated: false };
    } catch (err) {
      // 弱网重试撞上唯一键（userId+bizId）：回放已存在的对局，不再新开一局。
      // Redis 请求级去重通常先挡住，这里是持久兜底。
      if (err instanceof QueryFailedError) {
        const existing = await this.sessions.findOne({
          where: { userId, bizId },
        });
        if (existing) {
          return {
            session: this.toSessionView(existing, this.clock.now()),
            duplicated: true,
          };
        }
      }
      throw err;
    }
  }

  /** 结算：重算分数、发币、落 settled 态。同一玩家串行化，防并发重复结算。 */
  async settle(
    userId: string,
    sessionId: string,
    actions: MinigameActionDto[],
  ): Promise<{
    score: number;
    rewardCoin: number;
    wallet: WalletView;
    duplicated: boolean;
  }> {
    return this.lock.withLock(`minigame:${userId}`, async () => {
      const session = await this.sessions.findOne({
        where: { id: sessionId, userId },
      });
      if (!session) throw new BadRequestException('小游戏不存在');
      if (session.status !== 'open') {
        throw new BadRequestException('该对局已结算');
      }

      const now = this.clock.now();
      if (now.getTime() > session.expiresAt.getTime()) {
        session.status = 'expired';
        session.settledAt = now;
        await this.sessions.save(session);
        throw new BadRequestException('对局已过期');
      }

      const sessionCfg = await this.config.get('minigame.session');
      if (actions.length > sessionCfg.maxActionsPerSession) {
        throw new BadRequestException('操作序列校验失败');
      }

      const games = await this.config.get('minigame.games');
      const def = games.find((g) => g.key === session.gameKey);
      if (!def) throw new BadRequestException('小游戏不存在');

      const score = this.replayScore(session.seed, actions);
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
      return { score, rewardCoin, wallet, duplicated };
    });
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 占位回放算分器。
   *
   * 真正的「按 seed 重放操作序列、还原游戏内得分」是各小游戏各自的逻辑，后续接入；
   * 当前用一个对 (seed, actions) 确定性、且与客户端上报分数无关的函数占位。
   * 关键契约不是分值本身，而是**分数由服务端算**、客户端提交的分数一律忽略。
   */
  private replayScore(seed: string, actions: MinigameActionDto[]): number {
    const base = parseInt(seed.slice(0, 8), 16) || 1;
    let acc = 0;
    for (let i = 0; i < actions.length; i += 1) {
      const t = Math.trunc(actions[i].t) || 0;
      const x = Math.trunc(actions[i].x) || 0;
      acc += (base + i * 31 + t * 7 + x * 13) % 10;
    }
    return acc;
  }

  private toSessionView(
    session: MinigameSession,
    now: Date,
  ): MinigameSessionView {
    const remainMs = session.expiresAt.getTime() - now.getTime();
    return {
      id: session.id,
      seed: session.seed,
      expiresAt: session.expiresAt.toISOString(),
      remainSec: Math.max(0, Math.ceil(remainMs / 1000)),
    };
  }
}
