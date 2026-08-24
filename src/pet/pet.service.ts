import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { Pet } from '../entities/pet.entity';

/** 每小时衰减速率（服务端权威，按 last_seen_at 到当前的真实时长计算） */
const DECAY_PER_HOUR = { hunger: 5, mood: 3, cleanliness: 4 } as const;

/** 一次喂食效果 */
const FEED_EFFECT = { hunger: 30, exp: 10 } as const;

const STAT_MAX = 100;
const STAT_MIN = 0;

export interface PetStateView {
  hunger: number;
  mood: number;
  cleanliness: number;
  level: number;
  exp: number;
  lastSeenAt: string;
}

@Injectable()
export class PetService {
  constructor(
    @InjectRepository(Pet)
    private readonly pets: Repository<Pet>,
    private readonly clock: ClockService,
    private readonly lock: LockService,
  ) {}

  /** 读状态：按服务端时间算出衰减后的当前值（只读，不落库） */
  async getState(userId: string): Promise<{ pet: PetStateView }> {
    const pet = await this.findOrCreatePet(userId);
    const current = this.computeCurrent(pet, this.clock.now());
    return { pet: this.toView(current, pet) };
  }

  /** 喂食：玩家级锁内 → 衰减到当前 → 应用喂食 → 更新 last_seen_at → 落库 */
  async feed(userId: string): Promise<{ pet: PetStateView }> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      const pet = await this.findOrCreatePet(userId);
      const now = this.clock.now();
      const current = this.computeCurrent(pet, now);

      pet.hunger = this.clamp(current.hunger + FEED_EFFECT.hunger);
      pet.mood = current.mood;
      pet.cleanliness = current.cleanliness;
      pet.exp = current.exp + FEED_EFFECT.exp;
      pet.level = current.level;
      pet.lastSeenAt = now;

      const saved = await this.pets.save(pet);
      return { pet: this.toView(this.snapshot(saved), saved) };
    });
  }

  private async findOrCreatePet(userId: string): Promise<Pet> {
    const existing = await this.pets.findOne({ where: { userId } });
    if (existing) return existing;

    const created = this.pets.create({
      userId,
      hunger: STAT_MAX,
      mood: 80,
      cleanliness: STAT_MAX,
      level: 1,
      exp: 0,
      lastSeenAt: this.clock.now(),
    });
    return this.pets.save(created);
  }

  /** 纯函数：把库里的值按 elapsed 衰减到「当前」 */
  private computeCurrent(
    pet: Pet,
    now: Date,
  ): {
    hunger: number;
    mood: number;
    cleanliness: number;
    level: number;
    exp: number;
  } {
    const elapsedHours = Math.max(
      0,
      (now.getTime() - new Date(pet.lastSeenAt).getTime()) / 3_600_000,
    );
    return {
      hunger: this.clamp(pet.hunger - DECAY_PER_HOUR.hunger * elapsedHours),
      mood: this.clamp(pet.mood - DECAY_PER_HOUR.mood * elapsedHours),
      cleanliness: this.clamp(
        pet.cleanliness - DECAY_PER_HOUR.cleanliness * elapsedHours,
      ),
      level: pet.level,
      exp: pet.exp,
    };
  }

  private snapshot(pet: Pet) {
    return {
      hunger: pet.hunger,
      mood: pet.mood,
      cleanliness: pet.cleanliness,
      level: pet.level,
      exp: pet.exp,
    };
  }

  private toView(
    stats: {
      hunger: number;
      mood: number;
      cleanliness: number;
      level: number;
      exp: number;
    },
    pet: Pet,
  ): PetStateView {
    return {
      hunger: stats.hunger,
      mood: stats.mood,
      cleanliness: stats.cleanliness,
      level: stats.level,
      exp: stats.exp,
      lastSeenAt: new Date(pet.lastSeenAt).toISOString(),
    };
  }

  private clamp(v: number): number {
    return Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(v)));
  }
}
