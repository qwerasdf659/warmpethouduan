import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdTokenService } from '../boost/ad-token.service';
import { ClockService } from '../common/clock/clock.service';
import { EconomyService } from '../economy/economy.service';
import { PetService } from '../pet/pet.service';
import { RaceRecord } from '../entities/race-record.entity';
import {
  OPPONENT_COUNT,
  RACE_REVIVE,
  RACE_TRACKS,
  RaceTrack,
  getTrack,
  rewardOfRank,
} from './race.config';

export interface RaceStartResult {
  raceId: string;
  trackKey: string;
  rank: number;
  totalRacers: number;
  playerScore: number;
  opponentScores: number[];
  /** 报名后出战宠剩余体力 */
  staminaLeft: number;
  status: 'pending';
}

export interface RaceSettleResult {
  raceId: string;
  rank: number;
  totalRacers: number;
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
  playerScore: number;
  opponentScores: number[];
  rewardCoin: number;
  /** 重跑前的名次，便于前端做对比演出 */
  previousRank: number;
  reviveCount: number;
  status: 'pending';
}

/**
 * 赛跑玩法。结果在 start 时由服务端算定并落库（pending），settle 时发奖（settled）。
 * 体力扣减委托 PetService（玩家级锁内结算），发奖走 EconomyService.apply
 *（bizId=race:{raceId} 持久幂等，settle 双发也不会重复计币）。
 */
@Injectable()
export class RaceService {
  constructor(
    @InjectRepository(RaceRecord)
    private readonly races: Repository<RaceRecord>,
    private readonly pet: PetService,
    private readonly economy: EconomyService,
    private readonly clock: ClockService,
    private readonly adToken: AdTokenService,
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
    return { tracks: RACE_TRACKS, battle };
  }

  /** 报名并跑一场：扣体力/门票 → 算名次 → 落 pending 记录。 */
  async start(
    userId: string,
    trackKey: string,
    bizId: string,
    petId?: string,
  ): Promise<RaceStartResult> {
    const track = getTrack(trackKey);
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

    // 服务端算定名次
    const power = this.powerOf(battle.speed, battle.endurance);
    const playerScore = Math.round(power * this.rand(0.9, 1.1));
    const opponentScores: number[] = [];
    for (let i = 0; i < OPPONENT_COUNT; i++) {
      opponentScores.push(
        Math.round(power * track.difficulty * this.rand(0.8, 1.05)),
      );
    }
    const rank = 1 + opponentScores.filter((s) => s > playerScore).length;
    const totalRacers = OPPONENT_COUNT + 1;
    const rewardCoin = rewardOfRank(track, rank);

    const saved = await this.races.save(
      this.races.create({
        userId,
        petId: battle.petId,
        trackKey: track.key,
        petLevel: battle.level,
        score: playerScore,
        rank,
        totalRacers,
        rewardCoin,
        staminaCost: track.staminaCost,
        status: 'pending',
        settledAt: null,
      }),
    );

    return {
      raceId: saved.id,
      trackKey: track.key,
      rank,
      totalRacers,
      playerScore,
      opponentScores,
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
    await this.races.update(
      { id: race.id, status: 'pending' },
      { status: 'settled', settledAt: this.clock.now() },
    );

    return {
      raceId: race.id,
      rank: race.rank,
      totalRacers: race.totalRacers,
      rewardCoin: race.rewardCoin,
      gameCoin,
      duplicated,
    };
  }

  // ---------------------------------------------------------------- 内部

  /** 基础战力：速度权重更高，耐力次之。 */
  private powerOf(speed: number, endurance: number): number {
    return speed * 2 + endurance;
  }

  private rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
