import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AdTokenService } from '../boost/ad-token.service';
import { ClockService } from '../common/clock/clock.service';
import {
  businessDayKey,
  secondsUntilNextBusinessDay,
} from '../common/time/business-day';
import { REDIS_CLIENT } from '../redis/redis.module';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { PetService } from '../pet/pet.service';
import { RaceRecord } from '../entities/race-record.entity';
import {
  RaceFormula,
  RaceGhost,
  RaceGrade,
  RaceGradeThresholds,
  RaceTrack,
  baseFinishTime,
  getTrack,
  gradeOf,
  jitterTime,
  npcFinishTime,
  rankOf,
  rewardOfRank,
} from './race.config';

export interface RaceStartResult {
  raceId: string;
  trackKey: string;
  rank: number;
  totalRacers: number;
  /** 玩家完赛时间（秒） */
  finishTime: number;
  /** 评级 S/A/B/C */
  grade: RaceGrade;
  /** 各影子的完赛时间（升序），供前端播放追赶演出 */
  opponentFinishTimes: number[];
  /** 影子来源：player 全真实玩家 / mixed 部分 / npc 全生成 */
  ghostSource: 'player' | 'mixed' | 'npc';
  /** 战力快照（不再决定名次，仅供展示） */
  playerScore: number;
  /** 报名后出战宠剩余体力 */
  staminaLeft: number;
  status: 'pending';
}

export interface RaceSettleResult {
  raceId: string;
  rank: number;
  totalRacers: number;
  finishTime: number | null;
  grade: RaceGrade | null;
  rewardCoin: number;
  gameCoin: number;
  duplicated: boolean;
}

export interface RaceDoubleResult {
  raceId: string;
  /** 本次翻倍额外发放的游戏币 */
  bonusCoin: number;
  /** 翻倍后本场总奖励 */
  totalRewardCoin: number;
  gameCoin: number;
  duplicated: boolean;
}

export interface RaceReviveResult {
  raceId: string;
  rank: number;
  totalRacers: number;
  finishTime: number;
  grade: RaceGrade;
  opponentFinishTimes: number[];
  ghostSource: 'player' | 'mixed' | 'npc';
  playerScore: number;
  rewardCoin: number;
  /** 重跑前的名次，便于前端做对比演出 */
  previousRank: number;
  /** 重跑前的完赛时间（旧记录可能为 null） */
  previousFinishTime: number | null;
  reviveCount: number;
  status: 'pending';
}

/** 一场比赛算定后的结果（玩家 + 影子）。 */
interface RaceOutcome {
  finishTime: number;
  grade: RaceGrade;
  opponentFinishTimes: number[];
  ghostSource: 'player' | 'mixed' | 'npc';
  rank: number;
  score: number;
  rewardCoin: number;
}

/**
 * 赛跑玩法。结果在 start 时由服务端算定并落库（pending），settle 时发奖（settled）。
 * 体力扣减委托 PetService（玩家级锁内结算），发奖走 EconomyService.apply
 *（bizId=race:{raceId} 持久幂等，settle 双发也不会重复计币）。
 *
 * 判定用**完赛时间**模型：speed/mood 定配速、endurance 定后程掉速，
 * 名次由完赛时间升序排出，评级由完赛时间比对赛道基准时间。
 * 奖励仍按名次折算——换判定模型不动经济产出。
 */
@Injectable()
export class RaceService {
  private readonly logger = new Logger('Race');

  constructor(
    @InjectRepository(RaceRecord)
    private readonly races: Repository<RaceRecord>,
    private readonly pet: PetService,
    private readonly economy: EconomyService,
    private readonly clock: ClockService,
    private readonly adToken: AdTokenService,
    private readonly config: GameConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 赛道列表（附玩家当前战力预览）。 */
  async listTracks(userId: string): Promise<{
    tracks: RaceTrack[];
    battle: {
      petId: string;
      nickname: string | null;
      level: number;
      power: number;
      stamina: number;
      staminaMax: number;
    } | null;
  }> {
    let battle: {
      petId: string;
      nickname: string | null;
      level: number;
      power: number;
      stamina: number;
      staminaMax: number;
    } | null = null;
    try {
      const s = await this.pet.getBattleStats(userId);
      battle = {
        petId: s.petId,
        nickname: s.nickname,
        level: s.level,
        power: this.powerOf(s.speed, s.endurance),
        stamina: s.stamina,
        staminaMax: s.staminaMax,
      };
    } catch {
      // 无宠：仅返回赛道，不阻断
      battle = null;
    }
    return { tracks: await this.config.get('race.tracks'), battle };
  }

  /** 报名并跑一场：扣体力/门票 → 算名次 → 落 pending 记录。 */
  async start(
    userId: string,
    trackKey: string,
    bizId: string,
    petId?: string,
  ): Promise<RaceStartResult> {
    const cfg = await this.config.snapshot();
    const track = getTrack(cfg['race.tracks'], trackKey);
    if (!track) throw new BadRequestException('未知赛道');

    // 先校验门票余额（避免扣了体力却付不起门票）
    if (track.entryCoin > 0) {
      const wallet = await this.economy.getWallet(userId);
      if (wallet.gameCoin < track.entryCoin) {
        throw new BadRequestException('游戏币不足以支付报名门票');
      }
    }

    // 扣体力（玩家级锁内结算，返回参赛战斗数值）
    const battle = await this.pet.raceSpendStamina(
      userId,
      track.staminaCost,
      petId,
    );

    // 扣门票（原子记账，余额不足会抛错——此时体力已扣，属极小概率并发，可接受）
    if (track.entryCoin > 0) {
      await this.economy.apply({
        userId,
        pool: 'game',
        delta: -track.entryCoin,
        bizId: `${bizId}:entry`,
        reason: 'race',
        refId: track.key,
      });
    }

    // 服务端算定完赛时间与名次
    const outcome = await this.runRace(userId, battle, track, cfg);
    const totalRacers = outcome.opponentFinishTimes.length + 1;

    const saved = await this.races.save(
      this.races.create({
        userId,
        petId: battle.petId,
        trackKey: track.key,
        petLevel: battle.level,
        score: outcome.score,
        finishTime: outcome.finishTime,
        grade: outcome.grade,
        ghostSource: outcome.ghostSource,
        rank: outcome.rank,
        totalRacers,
        rewardCoin: outcome.rewardCoin,
        staminaCost: track.staminaCost,
        status: 'pending',
        settledAt: null,
      }),
    );

    return {
      raceId: saved.id,
      trackKey: track.key,
      rank: outcome.rank,
      totalRacers,
      finishTime: outcome.finishTime,
      grade: outcome.grade,
      opponentFinishTimes: outcome.opponentFinishTimes,
      ghostSource: outcome.ghostSource,
      playerScore: outcome.score,
      staminaLeft: battle.stamina,
      status: 'pending',
    };
  }

  /** 结算领奖：发放已算定的奖励并置 settled；重复结算不重复发奖。 */
  async settle(userId: string, raceId: string): Promise<RaceSettleResult> {
    const race = await this.races.findOne({ where: { id: raceId, userId } });
    if (!race) throw new NotFoundException('赛跑记录不存在');

    // 已结算：直接回放，不再发奖
    if (race.status === 'settled') {
      const wallet = await this.economy.getWallet(userId);
      return {
        raceId: race.id,
        rank: race.rank,
        totalRacers: race.totalRacers,
        finishTime: race.finishTime,
        grade: race.grade,
        rewardCoin: race.rewardCoin,
        gameCoin: wallet.gameCoin,
        duplicated: true,
      };
    }

    let gameCoin: number;
    let duplicated = false;
    if (race.rewardCoin > 0) {
      const applied = await this.economy.apply({
        userId,
        pool: 'game',
        delta: race.rewardCoin,
        bizId: `race:${race.id}`,
        reason: 'race',
        refId: race.trackKey,
      });
      gameCoin = applied.wallet.gameCoin;
      duplicated = applied.duplicated;
    } else {
      gameCoin = (await this.economy.getWallet(userId)).gameCoin;
    }

    // 幂等地标记为已结算（仅当仍为 pending 时更新时间）
    const marked = await this.races.update(
      { id: race.id, status: 'pending' },
      { status: 'settled', settledAt: this.clock.now() },
    );

    // 每日任务打点：只在本次调用真正完成了状态流转时 +1，
    // 否则重复结算能把「完成 1 场赛跑」刷满
    if (marked.affected) {
      await this.bumpRaceTask(userId);
    }

    return {
      raceId: race.id,
      rank: race.rank,
      totalRacers: race.totalRacers,
      finishTime: race.finishTime,
      grade: race.grade,
      rewardCoin: race.rewardCoin,
      gameCoin,
      duplicated,
    };
  }

  /**
   * 看广告奖励翻倍：在已结算的基础上再发一份等额奖励。每场至多一次。
   *
   * 幂等有三层：`reward_doubled` 列做业务态去重、economy 用**稳定** bizId
   * `race:double:{raceId}`（不取客户端 bizId，否则换个 bizId 就能重复领）、
   * 更新语句带 `rewardDoubled: false` 条件兜住并发。
   */
  async doubleReward(
    userId: string,
    raceId: string,
    adToken: string,
  ): Promise<RaceDoubleResult> {
    const race = await this.races.findOne({ where: { id: raceId, userId } });
    if (!race) throw new NotFoundException('赛跑记录不存在');

    if (race.status !== 'settled') {
      throw new BadRequestException('请先结算本场比赛再翻倍');
    }
    if (race.rewardCoin <= 0) {
      throw new BadRequestException('本场无奖励可翻倍');
    }

    // 已翻倍：回放，不消耗凭证也不再发币
    if (race.rewardDoubled) {
      const wallet = await this.economy.getWallet(userId);
      return {
        raceId: race.id,
        bonusCoin: race.rewardCoin,
        totalRewardCoin: race.rewardCoin * 2,
        gameCoin: wallet.gameCoin,
        duplicated: true,
      };
    }

    await this.adToken.consume(userId, adToken, 'race_double');

    const applied = await this.economy.apply({
      userId,
      pool: 'game',
      delta: race.rewardCoin,
      bizId: `race:double:${race.id}`,
      reason: 'race',
      refId: race.trackKey,
    });

    await this.races.update(
      { id: race.id, rewardDoubled: false },
      { rewardDoubled: true },
    );

    return {
      raceId: race.id,
      bonusCoin: race.rewardCoin,
      totalRewardCoin: race.rewardCoin * 2,
      gameCoin: applied.wallet.gameCoin,
      duplicated: applied.duplicated,
    };
  }

  /**
   * 看广告复活重跑：对**未结算**的比赛按当前战力重掷名次，不再扣体力/门票。
   * 限每场 `race.revive.maxPerRace` 次——否则可反复重掷刷到第一名。
   */
  async revive(
    userId: string,
    raceId: string,
    adToken: string,
  ): Promise<RaceReviveResult> {
    const cfg = await this.config.snapshot();
    const revive = cfg['race.revive'];
    const race = await this.races.findOne({ where: { id: raceId, userId } });
    if (!race) throw new NotFoundException('赛跑记录不存在');

    if (race.status !== 'pending') {
      throw new BadRequestException('已结算的比赛不能复活重跑');
    }
    if (race.reviveCount >= revive.maxPerRace) {
      throw new BadRequestException('本场复活机会已用完');
    }

    const track = getTrack(cfg['race.tracks'], race.trackKey);
    if (!track) throw new BadRequestException('赛道配置已下线，无法重跑');

    await this.adToken.consume(userId, adToken, 'race_revive');

    // 用参赛那只宠的当前战力重掷（服务端权威，客户端无法干预）
    const battle = await this.pet.getBattleStats(userId, race.petId);
    // 复活加成体现为「完赛时间缩短」：scoreBonus 是倍率，时间上取其倒数
    const outcome = await this.runRace(userId, battle, track, cfg, {
      timeBonus: 1 / Math.max(0.01, revive.scoreBonus),
    });
    const previousRank = race.rank;
    const previousFinishTime = race.finishTime;

    // 条件更新兜住并发重跑：只有 revive_count 仍是读到的值时才写入
    const res = await this.races.update(
      { id: race.id, status: 'pending', reviveCount: race.reviveCount },
      {
        score: outcome.score,
        finishTime: outcome.finishTime,
        grade: outcome.grade,
        ghostSource: outcome.ghostSource,
        rank: outcome.rank,
        rewardCoin: outcome.rewardCoin,
        reviveCount: race.reviveCount + 1,
      },
    );
    if (!res.affected) {
      throw new BadRequestException('本场状态已变更，请刷新后重试');
    }

    return {
      raceId: race.id,
      rank: outcome.rank,
      totalRacers: race.totalRacers,
      finishTime: outcome.finishTime,
      grade: outcome.grade,
      opponentFinishTimes: outcome.opponentFinishTimes,
      ghostSource: outcome.ghostSource,
      playerScore: outcome.score,
      rewardCoin: outcome.rewardCoin,
      previousRank,
      previousFinishTime,
      reviveCount: race.reviveCount + 1,
      status: 'pending',
    };
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 跑一场：算玩家完赛时间 → 取影子对手时间 → 排名次 → 定评级与奖励。
   *
   * `timeBonus` < 1 表示给玩家的完赛时间打折（复活重跑用）。
   */
  private async runRace(
    userId: string,
    battle: { speed: number; endurance: number; mood: number; level: number },
    track: RaceTrack,
    cfg: {
      'race.formula': RaceFormula;
      'race.grade_thresholds': RaceGradeThresholds;
      'race.ghost': RaceGhost;
      'race.opponent_count': number;
      'race.rank_factor': number[];
    },
    opts: { timeBonus?: number } = {},
  ): Promise<RaceOutcome> {
    const formula = cfg['race.formula'];
    const base = baseFinishTime(battle, track, formula);
    const playerBase = base * (opts.timeBonus ?? 1);
    const finishTime = jitterTime(playerBase, formula.jitter);

    const { times: opponentFinishTimes, source: ghostSource } =
      await this.ghostTimes(
        userId,
        battle.level,
        track,
        base,
        cfg['race.opponent_count'],
        cfg['race.ghost'],
      );

    const rank = rankOf(finishTime, opponentFinishTimes);
    return {
      finishTime,
      grade: gradeOf(finishTime, track, cfg['race.grade_thresholds']),
      opponentFinishTimes: [...opponentFinishTimes].sort((a, b) => a - b),
      ghostSource,
      rank,
      score: Math.round(this.powerOf(battle.speed, battle.endurance)),
      rewardCoin: rewardOfRank(track, rank, cfg['race.rank_factor']),
    };
  }

  /**
   * 取影子对手的完赛时间。
   *
   * 优先采样**真实玩家**在同赛道、同等级带、回溯期内的成绩，让对手有真实感；
   * 采样不足 `minSamples` 就整场退回 NPC——只有 1 个真实影子时名次会失真
   *（要么第一要么第二），不如全用生成的。
   *
   * 采样值会按玩家自己的基准时间钳到 `[clampMin, clampMax]` 区间：
   * 别人刷出的极端成绩（改档、卡 bug、或纯粹是满级号）不该让新手直接垫底，
   * 反过来摆烂样本也不该让人白捡第一。钳制而非丢弃，是为了保留「有人比你快」
   * 的信息量，同时把影响限制在可控范围。
   */
  private async ghostTimes(
    userId: string,
    petLevel: number,
    track: RaceTrack,
    playerBase: number,
    count: number,
    ghost: RaceGhost,
  ): Promise<{
    times: number[];
    source: 'player' | 'mixed' | 'npc';
  }> {
    if (!ghost.enabled || count <= 0) {
      return { times: this.npcTimes(playerBase, track, count), source: 'npc' };
    }

    let sampled: number[] = [];
    try {
      sampled = await this.sampleGhosts(userId, petLevel, track, count, ghost);
    } catch {
      // 采样是增强项，失败不该让人跑不了比赛（软失败不死亡）
      sampled = [];
    }

    if (sampled.length < ghost.minSamples) {
      return { times: this.npcTimes(playerBase, track, count), source: 'npc' };
    }

    const lo = playerBase * ghost.clampMin;
    const hi = playerBase * ghost.clampMax;
    const times = sampled
      .slice(0, count)
      .map((t) => Math.round(Math.min(hi, Math.max(lo, t)) * 1000) / 1000);

    // 真实成绩不够填满赛道，剩下的名额用 NPC 补齐
    const missing = count - times.length;
    if (missing > 0) {
      times.push(...this.npcTimes(playerBase, track, missing));
      return { times, source: 'mixed' };
    }
    return { times, source: 'player' };
  }

  private async sampleGhosts(
    userId: string,
    petLevel: number,
    track: RaceTrack,
    count: number,
    ghost: RaceGhost,
  ): Promise<number[]> {
    const since = new Date(
      this.clock.now().getTime() - ghost.lookbackDays * 86_400_000,
    );
    // 随机取样而非取最快的 N 条，否则同一批「最强成绩」会反复出现在所有人面前
    const rows = await this.races
      .createQueryBuilder('r')
      .select('r.finish_time', 'finishTime')
      .where('r.track_key = :trackKey', { trackKey: track.key })
      .andWhere('r.user_id <> :userId', { userId })
      // 只采已结算的成绩：pending 的比赛可能被复活重跑改掉成绩，也可能被直接弃赛
      .andWhere("r.status = 'settled'")
      .andWhere('r.finish_time IS NOT NULL')
      .andWhere('r.created_at >= :since', { since })
      .andWhere('r.pet_level BETWEEN :lo AND :hi', {
        lo: petLevel - ghost.levelBand,
        hi: petLevel + ghost.levelBand,
      })
      .orderBy('RANDOM()')
      .limit(count)
      .getRawMany<{ finishTime: string }>();

    return rows
      .map((r) => Number(r.finishTime))
      .filter((t) => Number.isFinite(t) && t > 0);
  }

  private npcTimes(
    playerBase: number,
    track: RaceTrack,
    count: number,
  ): number[] {
    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      times.push(npcFinishTime(playerBase, track));
    }
    return times;
  }

  /**
   * 「完成赛跑」每日任务计数（DailyService 读同一个 key）。
   *
   * 计数器失败不该让玩家拿不到已算定的奖励 —— 奖励已经发了，
   * 这里只是任务进度，软失败即可。
   */
  private async bumpRaceTask(userId: string): Promise<void> {
    try {
      const now = this.clock.now();
      const key = `act:${userId}:${businessDayKey(now)}:race`;
      await this.redis.incr(key);
      await this.redis.expire(key, secondsUntilNextBusinessDay(now));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`赛跑任务计数失败（已忽略）: ${msg}`);
    }
  }

  /** 战力快照：速度权重更高，耐力次之。已不参与名次判定，仅作展示与分析。 */
  private powerOf(speed: number, endurance: number): number {
    return speed * 2 + endurance;
  }
}
