import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { PlayerStatusService } from '../auth/player-status.service';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { Pet } from '../entities/pet.entity';
import { PetTrick } from '../entities/pet-trick.entity';
import { GAME_COIN } from '../ledger/ledger.types';
import { RewardService } from '../ledger/reward.service';
import { HomeComfortService } from '../home/home-comfort.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  buildPetTuning,
  levelOf,
  snapshot,
  spendStamina,
  toView,
  type PetStateView,
  type PetTuning,
} from '../pet/pet-math';

export interface TrickView {
  key: string;
  name: string;
  requireLevel: number;
  requirePlayCount: number;
  unlocked: boolean;
  learned: boolean;
  proficiency: number;
  playCount: number;
  cooldownRemainMs: number;
}

@Injectable()
export class TrainingService {
  constructor(
    @InjectRepository(Pet)
    private readonly pets: Repository<Pet>,
    @InjectRepository(PetTrick)
    private readonly tricks: Repository<PetTrick>,
    private readonly reward: RewardService,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly playerStatus: PlayerStatusService,
    private readonly homeComfort: HomeComfortService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async tuning(): Promise<PetTuning> {
    return buildPetTuning(await this.config.snapshot());
  }

  private async resolvePet(userId: string, petId?: string): Promise<Pet> {
    if (petId) {
      const p = await this.pets.findOne({ where: { id: petId, userId } });
      if (!p) throw new NotFoundException('宠物不存在');
      return p;
    }
    const active = await this.pets.findOne({
      where: { userId, isActive: true },
    });
    if (active) return active;
    const any = await this.pets.findOne({
      where: { userId, status: 'active' },
      order: { id: 'ASC' },
    });
    if (!any) throw new NotFoundException('没有宠物');
    return any;
  }

  private cdKey(petId: string, trickKey: string): string {
    return `cd:trick:${petId}:${trickKey}`;
  }

  // ---------------------------------------------------------------- 读

  async listTricks(
    userId: string,
    petId?: string,
  ): Promise<{ list: TrickView[]; total: number }> {
    const t = await this.tuning();
    const pet = await this.resolvePet(userId, petId);
    const defs = await this.config.get('training.tricks');
    const learned = await this.tricks.find({ where: { petId: pet.id } });
    const level = levelOf(pet.exp, t.growth).level;
    const list: TrickView[] = [];
    for (const def of defs) {
      const row = learned.find((r) => r.trickKey === def.key);
      const remainMs = await this.redis.pttl(this.cdKey(pet.id, def.key));
      list.push({
        key: def.key,
        name: def.name,
        requireLevel: def.requireLevel,
        requirePlayCount: def.requirePlayCount,
        unlocked:
          level >= def.requireLevel &&
          (pet.playCount ?? 0) >= def.requirePlayCount,
        learned: !!row,
        proficiency: row?.proficiency ?? 0,
        playCount: pet.playCount ?? 0,
        cooldownRemainMs: remainMs > 0 ? remainMs : 0,
      });
    }
    return { list, total: list.length };
  }

  // ---------------------------------------------------------------- 写

  /** 结算体力并扣减（调用方已持 pet 锁）。就地改写 `pet`，未落库。 */
  private async spendStamina(pet: Pet, t: PetTuning, cost: number, now: Date) {
    const comfort = await this.homeComfort.comfortOf(pet.userId);
    if (!spendStamina(pet, t, cost, now, comfort)) {
      throw new BadRequestException('体力不足');
    }
  }

  async practice(
    userId: string,
    bizId: string,
    trickKey: string,
    petId?: string,
  ): Promise<{
    trick: TrickView;
    proficiencyGain: number;
    pet: PetStateView;
    duplicated: boolean;
  }> {
    const t = await this.tuning();
    const defs = await this.config.get('training.tricks');
    const def = defs.find((d) => d.key === trickKey);
    if (!def) throw new BadRequestException('技巧不存在');

    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.playerStatus.assertNotBanned(userId);
      const pet = await this.resolvePet(userId, petId);
      const level = levelOf(pet.exp, t.growth).level;
      if (level < def.requireLevel) throw new BadRequestException('等级不足');
      if ((pet.playCount ?? 0) < def.requirePlayCount) {
        throw new BadRequestException('陪玩次数不足，无法学习');
      }
      const key = this.cdKey(pet.id, trickKey);
      const remain = await this.redis.pttl(key);
      if (remain > 0) throw new BadRequestException('技巧冷却中');

      const now = this.clock.now();
      await this.spendStamina(pet, t, def.staminaCost, now);
      const saved = await this.pets.save(pet);

      let row = await this.tricks.findOne({
        where: { petId: pet.id, trickKey },
      });
      if (!row) {
        row = this.tricks.create({
          petId: pet.id,
          userId,
          trickKey,
          proficiency: 0,
          learnedAt: now,
        });
      }
      row.proficiency = Math.min(100, row.proficiency + def.proficiencyGain);
      row.lastPracticeAt = now;
      const savedTrick = await this.tricks.save(row);

      if (def.cooldownMs > 0) {
        await this.redis.set(key, '1', 'PX', def.cooldownMs);
      }

      return {
        trick: {
          key: def.key,
          name: def.name,
          requireLevel: def.requireLevel,
          requirePlayCount: def.requirePlayCount,
          unlocked: true,
          learned: true,
          proficiency: savedTrick.proficiency,
          playCount: saved.playCount ?? 0,
          cooldownRemainMs: def.cooldownMs,
        },
        proficiencyGain: def.proficiencyGain,
        pet: toView(saved, snapshot(saved), t),
        duplicated: false,
      };
    });
  }

  async perform(
    userId: string,
    bizId: string,
    trickKey: string,
    petId?: string,
  ): Promise<{
    gained: { intimacy: number; coin: number };
    pet: PetStateView;
    wallet: WalletView;
    duplicated: boolean;
  }> {
    const t = await this.tuning();
    const defs = await this.config.get('training.tricks');
    const def = defs.find((d) => d.key === trickKey);
    if (!def) throw new BadRequestException('技巧不存在');

    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.playerStatus.assertNotBanned(userId);
      const pet = await this.resolvePet(userId, petId);
      const row = await this.tricks.findOne({
        where: { petId: pet.id, trickKey },
      });
      if (!row) throw new BadRequestException('尚未学会该技巧');
      const key = this.cdKey(pet.id, trickKey);
      const remain = await this.redis.pttl(key);
      if (remain > 0) throw new BadRequestException('技巧冷却中');

      const now = this.clock.now();
      await this.spendStamina(pet, t, def.staminaCost, now);
      pet.intimacy = pet.intimacy + def.perform.intimacy;
      const saved = await this.pets.save(pet);

      // 表演收益不并入 pet.daily_cap（那个封顶只服务 interact）
      const res = await this.reward.grant(
        userId,
        [{ assetCode: GAME_COIN, count: def.perform.coin }],
        { reason: 'training', bizKey: `${bizId}:perform` },
      );
      if (def.cooldownMs > 0) {
        await this.redis.set(key, '1', 'PX', def.cooldownMs);
      }
      const wallet = await this.economy.getWallet(userId);
      return {
        gained: { intimacy: def.perform.intimacy, coin: def.perform.coin },
        pet: toView(saved, snapshot(saved), t),
        wallet,
        duplicated: res.duplicated,
      };
    });
  }
}
