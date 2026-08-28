import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { PlayerStatusService } from '../auth/player-status.service';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { BUSINESS_TZ } from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { Pet } from '../entities/pet.entity';
import { PetCondition } from '../entities/pet-condition.entity';
import { GAME_COIN } from '../ledger/ledger.types';
import { RewardService } from '../ledger/reward.service';
import { PetService } from '../pet/pet.service';
import type { PetStateView } from '../pet/pet-math';
import type {
  PetConditionDef,
  PetConditionSource,
  PetRates,
} from '../pet/pet.config';

export interface ConditionView {
  key: string;
  name: string;
  desc: string;
  source: PetConditionSource;
  since: string;
  effects: Record<string, number>;
  curableBy: string[];
  affectsOffline: boolean;
  /**
   * 自愈进度。让前端能明确告诉玩家「把饱食度养到 60 以上，撑 6 小时就自己好了」，
   * 而不是只给一个「可自愈」的空承诺。
   */
  selfHeal: {
    statThreshold: number;
    statNow: number;
    sustainHours: number;
    /** 还需维持的秒数；`null` = 属性尚未达标，维持计时还没开始 */
    remainSec: number | null;
  };
}

export interface CureResult {
  pet: PetStateView;
  cured: string[];
  wallet: WalletView;
  duplicated: boolean;
}

@Injectable()
export class ConditionService {
  constructor(
    @InjectRepository(PetCondition)
    private readonly conditions: Repository<PetCondition>,
    @InjectRepository(Pet)
    private readonly pets: Repository<Pet>,
    private readonly reward: RewardService,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly playerStatus: PlayerStatusService,
    private readonly petService: PetService,
  ) {}

  /** 定位目标宠（active 优先），无则 404。只认有效宠（status='active'）。 */
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

  private storedOf(pet: Pet, source: PetConditionSource): number {
    return source === 'hunger'
      ? pet.hunger
      : source === 'cleanliness'
        ? pet.cleanliness
        : pet.mood;
  }

  private rateOf(rates: PetRates, source: PetConditionSource): number {
    return source === 'hunger'
      ? rates.hunger
      : source === 'cleanliness'
        ? rates.cleanliness
        : rates.moodBase;
  }

  /**
   * 该属性此刻的值（惰性衰减：库里存的是 `last_seen_at` 时刻的快照）。
   *
   * 与 `judge()` 用同一套简化模型（线性衰减、不含舒适度减免与饥饿加速），
   * 这是刻意的：生病与自愈必须同一把尺子，否则会出现「按一把尺子判生病、
   * 按另一把判没好」的死循环。
   */
  private currentStatOf(
    pet: Pet,
    now: Date,
    rates: PetRates,
    source: PetConditionSource,
  ): number {
    const stored = this.storedOf(pet, source);
    const rate = this.rateOf(rates, source);
    if (rate <= 0) return stored;
    const elapsedH =
      (now.getTime() - new Date(pet.lastSeenAt).getTime()) / 3_600_000;
    return Math.max(0, stored - rate * elapsedH);
  }

  /**
   * 纯判定：返回该宠此刻应处于的病症与起病时刻。
   * zeroSince = last_seen_at + stored/rate 小时；满 thresholdHours 即触发。
   */
  private judge(
    pet: Pet,
    now: Date,
    rates: PetRates,
    defs: PetConditionDef[],
  ): { key: string; since: Date }[] {
    const out: { key: string; since: Date }[] = [];
    const lastSeen = new Date(pet.lastSeenAt).getTime();
    for (const def of defs) {
      const rate = this.rateOf(rates, def.source);
      if (rate <= 0) continue; // 该属性永不衰减
      const stored = this.storedOf(pet, def.source);
      const zeroAtMs = lastSeen + (stored / rate) * 3_600_000;
      const sickAtMs = zeroAtMs + def.thresholdHours * 3_600_000;
      if (now.getTime() >= sickAtMs)
        out.push({ key: def.key, since: new Date(sickAtMs) });
    }
    return out;
  }

  /** 幂等插入活跃病症（部分唯一索引兜并发）。 */
  private async ensureCondition(
    pet: Pet,
    key: string,
    since: Date,
  ): Promise<void> {
    const exists = await this.conditions.findOne({
      where: { petId: pet.id, conditionKey: key, curedAt: IsNull() },
    });
    if (exists) return;
    try {
      await this.conditions.save(
        this.conditions.create({
          petId: pet.id,
          userId: pet.userId,
          conditionKey: key,
          since,
        }),
      );
    } catch {
      // 并发下另一个请求先插入，唯一索引冲突可安全忽略
    }
  }

  // ---------------------------------------------------------------- 读

  /** GET /pet/conditions：纯读，返回活跃病症 + 配置文案，不判定、不写库。 */
  async listConditions(
    userId: string,
    petId?: string,
  ): Promise<{ conditions: ConditionView[] }> {
    const pet = await this.resolvePet(userId, petId);
    const rows = await this.conditions.find({
      where: { petId: pet.id, curedAt: IsNull() },
      order: { since: 'ASC' },
    });
    const defs = await this.config.get('pet.conditions');
    const cure = await this.config.get('pet.cure');
    const rates = await this.config.get('pet.rates');
    const now = this.clock.now();

    const conditions = rows.map((r) => {
      const def = defs.find((d) => d.key === r.conditionKey);
      const stat = def ? this.currentStatOf(pet, now, rates, def.source) : 0;
      // 自愈已进入维持期还需多久。null = 属性还没达标，先把属性养上去
      const selfHealInSec =
        r.healthySince === null
          ? null
          : Math.max(
              0,
              Math.ceil(
                (cure.selfHealHours * 3_600_000 -
                  (now.getTime() - new Date(r.healthySince).getTime())) /
                  1000,
              ),
            );
      return {
        key: r.conditionKey,
        name: def?.name ?? r.conditionKey,
        desc: def?.desc ?? '',
        source: def?.source ?? 'hunger',
        since: new Date(r.since).toISOString(),
        effects: (def?.effects ?? {}) as Record<string, number>,
        curableBy: ['item', 'clinic', 'self'],
        // 离线收益是账号级、只取出战宠：让前端看得出这只病是否真正拖累离线收益
        affectsOffline: pet.isActive,
        /** 自愈进度：属性阈值、当前值、以及还需维持多久（未达标时为 null） */
        selfHeal: {
          statThreshold: cure.selfHealStat,
          statNow: Math.floor(stat),
          sustainHours: cure.selfHealHours,
          remainSec: selfHealInSec,
        },
      };
    });
    return { conditions };
  }

  // ---------------------------------------------------------------- 写

  /** POST /pet/cure：item 治一种（扣药），clinic 治全部（扣币）。 */
  async cure(
    userId: string,
    bizId: string,
    method: 'item' | 'clinic',
    petId?: string,
  ): Promise<CureResult> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.playerStatus.assertNotBanned(userId);
      const pet = await this.resolvePet(userId, petId);
      const active = await this.conditions.find({
        where: { petId: pet.id, curedAt: IsNull() },
        order: { since: 'ASC' },
      });
      if (active.length === 0) {
        throw new BadRequestException('该宠物没有需要治疗的病症');
      }

      const cure = await this.config.get('pet.cure');
      const now = this.clock.now();
      let duplicated = false;
      let cured: string[] = [];

      if (method === 'item') {
        const res = await this.reward.charge(
          userId,
          [{ assetCode: cure.assetCode, count: 1 }],
          { reason: 'cure', bizKey: `${bizId}:cure` },
        );
        duplicated = res.duplicated;
        const target = active[0];
        target.curedAt = now;
        target.curedBy = 'item';
        await this.conditions.save(target);
        cured = [target.conditionKey];
      } else {
        const res = await this.reward.charge(
          userId,
          [{ assetCode: GAME_COIN, count: cure.clinicCost }],
          { reason: 'cure', bizKey: `${bizId}:cure` },
        );
        duplicated = res.duplicated;
        for (const row of active) {
          row.curedAt = now;
          row.curedBy = 'clinic';
        }
        await this.conditions.save(active);
        cured = active.map((r) => r.conditionKey);
      }

      const { pet: view } = await this.petService.getState(userId, pet.id);
      const wallet = await this.economy.getWallet(userId);
      return { pet: view, cured, wallet, duplicated };
    });
  }

  // ---------------------------------------------------------------- 兜底 cron

  /**
   * 每小时补判：纯离线玩家不会走写路径，若不扫他们永远不会生病，
   * 而「长期疏于照顾」恰恰是本玩法的触发前提。避开 4:00–4:30 重活窗口。
   */
  @Cron('15 * * * *', {
    name: 'pet-condition-scan',
    timeZone: BUSINESS_TZ,
  })
  async scan(): Promise<void> {
    const rates = await this.config.get('pet.rates');
    const defs = await this.config.get('pet.conditions');
    if (!defs.length) return;
    const now = this.clock.now();

    const minThresholdH = Math.min(...defs.map((d) => d.thresholdHours));
    const cutoff = new Date(now.getTime() - minThresholdH * 3_600_000);
    const pets = await this.pets.find({
      where: { status: 'active', lastSeenAt: LessThan(cutoff) },
    });
    for (const pet of pets) {
      for (const { key, since } of this.judge(pet, now, rates, defs)) {
        await this.ensureCondition(pet, key, since);
      }
    }

    await this.selfHeal(now, rates, defs);
  }

  /**
   * 自愈：对应属性回到 `selfHealStat` 以上并**维持** `selfHealHours` 小时即痊愈。
   *
   * 单独一次查询而不是复用上面那批宠物：上面只捞 `last_seen_at` 早于阈值的
   * 「疏于照顾」宠，而自愈的对象恰恰相反——刚被喂饱、`last_seen_at` 很新的那些，
   * 它们根本不在那个集合里。
   *
   * 维持计时的精度受 cron 周期限制（每小时一次），因此实际等待是
   * `selfHealHours` ~ `selfHealHours + 1` 小时。这个误差是可接受的：
   * 自愈本身是「免费但慢」的那条路，用药和看诊才是即时的。
   */
  private async selfHeal(
    now: Date,
    rates: PetRates,
    defs: PetConditionDef[],
  ): Promise<void> {
    const active = await this.conditions.find({ where: { curedAt: IsNull() } });
    if (active.length === 0) return;

    const cure = await this.config.get('pet.cure');
    const petIds = [...new Set(active.map((r) => r.petId))];
    const pets = await this.pets.find({ where: { id: In(petIds) } });
    const petById = new Map(pets.map((p) => [p.id, p]));
    const sustainMs = cure.selfHealHours * 3_600_000;

    for (const row of active) {
      const pet = petById.get(row.petId);
      // 配置里已删掉该病症时不擅自治愈：留着让运营看见这条脏数据，
      // 自动清掉只会让「病症配置被误删」这件事无声无息
      const def = defs.find((d) => d.key === row.conditionKey);
      if (!pet || !def) continue;

      const stat = this.currentStatOf(pet, now, rates, def.source);

      if (stat < cure.selfHealStat) {
        // 掉回阈值以下：维持中断，计时清零
        if (row.healthySince) {
          row.healthySince = null;
          await this.conditions.save(row);
        }
        continue;
      }

      if (!row.healthySince) {
        row.healthySince = now;
        await this.conditions.save(row);
        continue;
      }

      if (now.getTime() - new Date(row.healthySince).getTime() >= sustainMs) {
        row.curedAt = now;
        row.curedBy = 'self';
        row.healthySince = null;
        await this.conditions.save(row);
      }
    }
  }
}
