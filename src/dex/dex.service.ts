import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { EconomyService } from '../economy/economy.service';
import { PetService, PetStateView } from '../pet/pet.service';
import { DexClaim } from '../entities/dex-claim.entity';
import { DEX_ENTRIES, DexEntry, getDexEntry } from './dex.config';

export interface DexEntryView {
  key: string;
  name: string;
  desc: string;
  target: number;
  progress: number;
  reward: number;
  unlocked: boolean;
  claimed: boolean;
}

@Injectable()
export class DexService {
  constructor(
    @InjectRepository(DexClaim)
    private readonly claims: Repository<DexClaim>,
    private readonly pet: PetService,
    private readonly economy: EconomyService,
    private readonly lock: LockService,
  ) {}

  /** 图鉴列表（含进度/解锁/领取态）。 */
  async getDex(userId: string): Promise<{ entries: DexEntryView[] }> {
    const pets = await this.pet.peekPets(userId);
    const claimed = new Set(
      (await this.claims.find({ where: { userId } })).map((c) => c.entryKey),
    );
    return {
      entries: DEX_ENTRIES.map((e) => this.toView(e, pets, claimed)),
    };
  }

  /** 领取图鉴解锁奖励（达标且未领取）。 */
  async claim(
    userId: string,
    entryKey: string,
  ): Promise<{ entries: DexEntryView[]; gained: number; gameCoin: number }> {
    const entry = getDexEntry(entryKey);
    if (!entry) throw new BadRequestException('未知图鉴条目');

    return this.lock.withLock(`pet:${userId}`, async () => {
      const pets = await this.pet.peekPets(userId);
      if (this.progressOf(entry, pets) < entry.target) {
        throw new BadRequestException('图鉴条目尚未解锁');
      }
      const exists = await this.claims.findOne({
        where: { userId, entryKey },
      });
      if (exists) throw new BadRequestException('该图鉴奖励已领取');

      try {
        await this.claims.save(this.claims.create({ userId, entryKey }));
      } catch {
        throw new BadRequestException('该图鉴奖励已领取');
      }

      const applied = await this.economy.apply({
        userId,
        pool: 'game',
        delta: entry.reward,
        bizId: `dex:${entryKey}`,
        reason: 'dex',
        refId: entryKey,
      });

      const claimed = new Set(
        (await this.claims.find({ where: { userId } })).map((c) => c.entryKey),
      );
      return {
        entries: DEX_ENTRIES.map((e) => this.toView(e, pets, claimed)),
        gained: entry.reward,
        gameCoin: applied.wallet.gameCoin,
      };
    });
  }

  // ---------------------------------------------------------------- 内部

  private progressOf(entry: DexEntry, pets: PetStateView[]): number {
    switch (entry.type) {
      case 'maxLevel':
        return pets.reduce((m, p) => Math.max(m, p.level), 0);
      case 'petCount':
        return pets.length;
      case 'maxIntimacy':
        return pets.reduce((m, p) => Math.max(m, p.intimacy), 0);
      default:
        return 0;
    }
  }

  private toView(
    entry: DexEntry,
    pets: PetStateView[],
    claimed: Set<string>,
  ): DexEntryView {
    const progress = this.progressOf(entry, pets);
    return {
      key: entry.key,
      name: entry.name,
      desc: entry.desc,
      target: entry.target,
      progress: Math.min(progress, entry.target),
      reward: entry.reward,
      unlocked: progress >= entry.target,
      claimed: claimed.has(entry.key),
    };
  }
}
