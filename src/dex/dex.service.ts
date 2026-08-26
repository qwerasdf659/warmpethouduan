import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import type { PetStateView } from '../pet/pet-math';
import { PetService } from '../pet/pet.service';
import { ItemsService } from '../items/items.service';
import { DexClaim } from '../entities/dex-claim.entity';
import {
  COLLECT_TYPE_OF,
  COLLECTIBLE_TYPES,
  DexEntry,
  getDexEntry,
} from './dex.config';

/** 各进度口径的数据源快照（一次查好，供同一次请求内所有条目复用）。 */
interface ProgressContext {
  pets: PetStateView[];
  /** 物品类型 -> 已拥有种类数 */
  kinds: Record<string, number>;
}

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
    private readonly config: GameConfigService,
    private readonly items: ItemsService,
  ) {}

  /** 图鉴列表（含进度/解锁/领取态）。 */
  async getDex(userId: string): Promise<{ entries: DexEntryView[] }> {
    const defs = await this.config.get('dex.entries');
    const ctx = await this.progressContext(userId, defs);
    const claimed = new Set(
      (await this.claims.find({ where: { userId } })).map((c) => c.entryKey),
    );
    return {
      entries: defs.map((e) => this.toView(e, ctx, claimed)),
    };
  }

  /** 领取图鉴解锁奖励（达标且未领取）。 */
  async claim(
    userId: string,
    entryKey: string,
  ): Promise<{ entries: DexEntryView[]; gained: number; gameCoin: number }> {
    const defs = await this.config.get('dex.entries');
    const entry = getDexEntry(defs, entryKey);
    if (!entry) throw new BadRequestException('未知图鉴条目');

    return this.lock.withLock(`pet:${userId}`, async () => {
      const ctx = await this.progressContext(userId, defs);
      if (this.progressOf(entry, ctx) < entry.target) {
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
        entries: defs.map((e) => this.toView(e, ctx, claimed)),
        gained: entry.reward,
        gameCoin: applied.wallet.gameCoin,
      };
    });
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 一次性备好所有进度口径的数据源。
   *
   * 收集类条目的统计只在**真有**收集类条目时才查——图鉴是每次进页面都拉的接口，
   * 不该为了几个可能被运营删掉的条目固定多打一次 join 查询。
   */
  private async progressContext(
    userId: string,
    defs: DexEntry[],
  ): Promise<ProgressContext> {
    const pets = await this.pet.peekPets(userId);
    const needsCollect = defs.some((e) => e.type.startsWith('owned'));
    const kinds = needsCollect
      ? await this.items.ownedKindCount(userId)
      : ({} as Record<string, number>);
    return { pets, kinds };
  }

  private progressOf(entry: DexEntry, ctx: ProgressContext): number {
    switch (entry.type) {
      case 'maxLevel':
        return ctx.pets.reduce((m, p) => Math.max(m, p.level), 0);
      case 'petCount':
        return ctx.pets.length;
      case 'maxIntimacy':
        return ctx.pets.reduce((m, p) => Math.max(m, p.intimacy), 0);
      case 'ownedAll':
        // 只累加收藏品类型：消耗品不计（理由见 COLLECTIBLE_TYPES 注释）
        return COLLECTIBLE_TYPES.reduce((a, t) => a + (ctx.kinds[t] ?? 0), 0);
      default: {
        const itemType = COLLECT_TYPE_OF[entry.type];
        return itemType ? (ctx.kinds[itemType] ?? 0) : 0;
      }
    }
  }

  private toView(
    entry: DexEntry,
    ctx: ProgressContext,
    claimed: Set<string>,
  ): DexEntryView {
    const progress = this.progressOf(entry, ctx);
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
