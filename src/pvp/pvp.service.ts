import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Not, Repository } from 'typeorm';
import { PlayerStatusService } from '../auth/player-status.service';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import { Pet } from '../entities/pet.entity';
import { PetEquip } from '../entities/pet-equip.entity';
import { PvpMatch, PvpOpponentSnapshot } from '../entities/pvp-match.entity';
import { PvpRank } from '../entities/pvp-rank.entity';
import { GAME_COIN } from '../ledger/ledger.types';
import { RewardService } from '../ledger/reward.service';
import { getTrack, baseFinishTime, jitterTime } from '../race/race.config';
import { seasonOf } from './pvp.config';
import { levelOf, stageOf } from '../pet/pet-math';
import { PetService } from '../pet/pet.service';
import { PetBonusService } from '../pet-bonus/pet-bonus.service';

@Injectable()
export class PvpService {
  constructor(
    @InjectRepository(PvpRank) private readonly ranks: Repository<PvpRank>,
    @InjectRepository(PvpMatch) private readonly matches: Repository<PvpMatch>,
    @InjectRepository(Pet) private readonly pets: Repository<Pet>,
    @InjectRepository(PetEquip) private readonly equips: Repository<PetEquip>,
    private readonly reward: RewardService,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly playerStatus: PlayerStatusService,
    private readonly petService: PetService,
    private readonly petBonus: PetBonusService,
  ) {}

  /** 赛季标识：按自然季度切换（换季即天然重置榜单）。 */
  private seasonOf(now: Date): string {
    return seasonOf(now);
  }

  private async myRank(userId: string, season: string): Promise<PvpRank> {
    let row = await this.ranks.findOne({ where: { userId } });
    if (!row || row.season !== season) {
      const init = (await this.config.get('pvp.rank')).initialPoint;
      row = this.ranks.create({
        userId,
        season,
        rankPoint: init,
        wins: 0,
        losses: 0,
      });
    }
    return row;
  }

  private async appearanceOf(petId: string): Promise<Record<string, string>> {
    const rows = await this.equips.find({ where: { petId } });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.slot] = r.assetCode;
    return out;
  }

  private async snapshotOf(pet: Pet): Promise<PvpOpponentSnapshot> {
    const c = await this.config.snapshot();
    const level = levelOf(pet.exp, c['pet.growth']).level;
    const a = c['pet.attrs'];
    const round1 = (v: number) => Math.round(v * 10) / 10;
    return {
      userId: pet.userId,
      nickname: pet.nickname,
      level,
      speed: round1(a.speedBase + a.speedPerLevel * (level - 1)),
      endurance: round1(a.enduranceBase + a.endurancePerLevel * (level - 1)),
      stage: stageOf(level, c['pet.stages']),
      appearance: await this.appearanceOf(pet.id),
    };
  }

  private async activePetOf(userId: string): Promise<Pet | null> {
    return (
      (await this.pets.findOne({ where: { userId, isActive: true } })) ??
      (await this.pets.findOne({
        where: { userId, status: 'active' },
        order: { id: 'ASC' },
      }))
    );
  }

  // ---------------------------------------------------------------- opponents

  async opponents(userId: string) {
    const now = this.clock.now();
    const season = this.seasonOf(now);
    const cfg = await this.config.get('pvp.rank');
    const me = await this.myRank(userId, season);
    const rows = await this.ranks.find({
      where: {
        season,
        userId: Not(userId),
        rankPoint: Between(
          me.rankPoint - cfg.matchBand,
          me.rankPoint + cfg.matchBand,
        ),
      },
      take: cfg.opponentCount,
    });
    const list = [];
    for (const r of rows) {
      const pet = await this.activePetOf(r.userId);
      if (!pet) continue;
      const snap = await this.snapshotOf(pet);
      list.push({
        userId: r.userId,
        nickname: snap.nickname,
        rankPoint: r.rankPoint,
        petSnapshot: {
          level: snap.level,
          speed: snap.speed,
          endurance: snap.endurance,
          stage: snap.stage,
          appearance: snap.appearance,
        },
      });
    }
    return { list, total: list.length };
  }

  // ---------------------------------------------------------------- challenge

  async challenge(
    userId: string,
    bizId: string,
    opponentUserId: string,
    trackKey: string,
  ) {
    if (userId === opponentUserId) {
      throw new BadRequestException('不能挑战自己');
    }
    const c = await this.config.snapshot();
    const track = getTrack(c['race.tracks'], trackKey);
    if (!track) throw new BadRequestException('赛道不存在');
    const rankCfg = c['pvp.rank'];
    const rewardCfg = c['pvp.reward'];
    const formula = c['race.formula'];
    const now = this.clock.now();
    const season = this.seasonOf(now);

    // 用 pvp: 锁而非 pet: 锁：challenge 内部会调用 raceSpendStamina，后者自身取 pet: 锁，
    // Redis 锁不可重入，若这里也占 pet: 锁会自死锁（表现为 409）。两把锁各管各的临界区。
    return this.lock.withLock(`pvp:${userId}`, async () => {
      await this.playerStatus.assertNotBanned(userId);

      // 幂等回放
      const dup = await this.matches.findOne({
        where: { challengerUserId: userId, bizId },
      });
      if (dup) {
        const rank = await this.myRank(userId, season);
        const { pet } = await this.petService.getState(userId);
        return {
          match: this.matchView(dup),
          pet,
          rank: {
            rankPoint: rank.rankPoint,
            wins: rank.wins,
            losses: rank.losses,
          },
          wallet: await this.economy.getWallet(userId),
          duplicated: true,
        };
      }

      const oppPet = await this.activePetOf(opponentUserId);
      if (!oppPet) throw new NotFoundException('对手不存在');
      const oppRank = await this.myRank(opponentUserId, season);
      const oppSnap = await this.snapshotOf(oppPet);

      // 扣体力并取参赛数值（复用赛跑的体力扣减）
      const my = await this.petService.raceSpendStamina(
        userId,
        track.staminaCost,
      );

      // 双方按同一套公式真实算完赛时间，不钳制、不随机填充；
      // raceScore 加成（病症/Petpet/融合/技巧掌握）分别作用于各自完赛时间（>0 更快）。
      const myRaceScore = (await this.petBonus.bonusOfPetId(my.petId))
        .raceScore;
      const oppRaceScore = (await this.petBonus.bonusOf(oppPet)).raceScore;
      const myTime = jitterTime(
        baseFinishTime(
          { speed: my.speed, endurance: my.endurance, mood: my.mood },
          track,
          formula,
        ) / Math.max(0.1, 1 + myRaceScore),
        formula.jitter,
      );
      const oppTime = jitterTime(
        baseFinishTime(
          { speed: oppSnap.speed, endurance: oppSnap.endurance, mood: 80 },
          track,
          formula,
        ) / Math.max(0.1, 1 + oppRaceScore),
        formula.jitter,
      );
      const win = myTime < oppTime;

      const me = await this.myRank(userId, season);
      const expected =
        1 / (1 + Math.pow(10, (oppRank.rankPoint - me.rankPoint) / 400));
      const delta = Math.round(rankCfg.kFactor * ((win ? 1 : 0) - expected));
      me.rankPoint = Math.max(0, me.rankPoint + delta);
      me.season = season;
      if (win) me.wins += 1;
      else me.losses += 1;
      await this.ranks.save(me);

      const rewardCoin = win ? rewardCfg.winCoin : rewardCfg.loseCoin;
      const res = await this.reward.grant(
        userId,
        [{ assetCode: GAME_COIN, count: rewardCoin }],
        { reason: 'pvp', bizKey: `${bizId}:pvp` },
      );

      const match = await this.matches.save(
        this.matches.create({
          season,
          challengerUserId: userId,
          opponentUserId,
          trackKey,
          challengerTime: myTime.toFixed(2),
          opponentTime: oppTime.toFixed(2),
          win,
          rankPointDelta: delta,
          rewardCoin,
          opponentSnapshot: oppSnap,
          bizId,
        }),
      );

      const { pet } = await this.petService.getState(userId);
      return {
        match: this.matchView(match),
        pet,
        rank: { rankPoint: me.rankPoint, wins: me.wins, losses: me.losses },
        wallet: await this.economy.getWallet(userId),
        duplicated: res.duplicated,
      };
    });
  }

  private matchView(m: PvpMatch) {
    return {
      id: m.id,
      trackKey: m.trackKey,
      challengerTime: Number(m.challengerTime),
      opponentTime: Number(m.opponentTime),
      win: m.win,
      rankPointDelta: m.rankPointDelta,
      rewardCoin: m.rewardCoin,
      createdAt: new Date(m.createdAt).toISOString(),
    };
  }

  // ---------------------------------------------------------------- rank/history

  async rank(userId: string, page: number, pageSize: number) {
    const season = this.seasonOf(this.clock.now());
    const [rows, total] = await this.ranks.findAndCount({
      where: { season },
      order: { rankPoint: 'DESC', updatedAt: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const list = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const pet = await this.activePetOf(r.userId);
      list.push({
        rank: (page - 1) * pageSize + i + 1,
        userId: r.userId,
        nickname: pet?.nickname ?? null,
        rankPoint: r.rankPoint,
        wins: r.wins,
        losses: r.losses,
      });
    }
    const me = await this.myRank(userId, season);
    const higher = await this.ranks.count({
      where: { season, rankPoint: Between(me.rankPoint + 1, 1_000_000) },
    });
    return {
      list,
      total,
      me: {
        rank: higher + 1,
        rankPoint: me.rankPoint,
        wins: me.wins,
        losses: me.losses,
      },
    };
  }

  async history(
    userId: string,
    page: number,
    pageSize: number,
    role: 'challenger' | 'opponent',
  ) {
    const where =
      role === 'opponent'
        ? { opponentUserId: userId }
        : { challengerUserId: userId };
    const [rows, total] = await this.matches.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list: rows.map((m) => this.matchView(m)), total };
  }
}
