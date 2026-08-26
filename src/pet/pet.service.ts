import {
  BadRequestException,
  HttpException,
  HttpStatus,
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
import {
  businessDayKey,
  secondsUntilNextBusinessDay,
} from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { EconomyService } from '../economy/economy.service';
import { Pet } from '../entities/pet.entity';
import { User } from '../entities/user.entity';
import { HomeComfortService } from '../home/home-comfort.service';
import {
  clamp,
  clampStat,
  levelOf,
  settle,
  snapshot,
  staminaMaxOf,
  toView,
  type PetStateView,
  type PetTuning,
} from './pet-math';
import {
  comfortFactorOf,
  type DailyCapResource,
  type PetActionKey,
  type PetComfort,
  type PetDailyCap,
  type PetGrowth,
  type PetOffline,
} from './pet.config';

export interface ActionResult {
  pet: PetStateView;
  /** 本次实发产出（受每日上限截断后的真实值） */
  gained: { intimacy: number; exp: number; coin: number };
  /** 因每日上限被截断 */
  capped: boolean;
  levelUp: boolean;
  cooldownRemainMs: number;
  /** 发币后的最新游戏币余额（未发币则为发币前余额） */
  gameCoin: number;
}

/** 赛跑等玩法用的战斗数值快照。 */
export interface BattleStats {
  petId: string;
  nickname: string | null;
  level: number;
  speed: number;
  endurance: number;
  stamina: number;
  staminaMax: number;
  /** 结算后的当前心情：参与赛跑配速（心情差跑得慢），见 RaceService */
  mood: number;
}

/** 后台补偿调整入参（数值均可选，未给则不动）。 */
export interface AdminAdjustInput {
  petId?: string;
  mode: 'set' | 'delta';
  hunger?: number;
  mood?: number;
  cleanliness?: number;
  stamina?: number;
  intimacy?: number;
  exp?: number;
}

/** 离线收益预览（出参）。`comfortFactor` 让前端能解释「家园加成 +x%」。 */
export interface OfflineView {
  elapsedSec: number;
  cappedSec: number;
  maxHours: number;
  /** 已含等级加成与家园加成的时薪 */
  coinPerHour: number;
  /** 家园舒适度换算的加成系数，0 表示没有家具 */
  comfortFactor: number;
  claimableCoin: number;
}

@Injectable()
export class PetService {
  constructor(
    @InjectRepository(Pet)
    private readonly pets: Repository<Pet>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly homeComfort: HomeComfortService,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly economy: EconomyService,
    private readonly playerStatus: PlayerStatusService,
    private readonly config: GameConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 取本次请求的配置快照。 */
  private async tuning(): Promise<PetTuning> {
    const c = await this.config.snapshot();
    return {
      rates: c['pet.rates'],
      growth: c['pet.growth'],
      attrs: c['pet.attrs'],
      stages: c['pet.stages'],
      actions: c['pet.actions'],
      dailyCap: c['pet.daily_cap'],
      maxPets: c['pet.max_pets_per_user'],
      offline: c['pet.offline'],
      comfort: c['pet.comfort'],
    };
  }

  /** 读家园舒适度换算的心情衰减减免系数（没摆家具则 0）。 */
  private async comfortFactor(
    userId: string,
    cfg: PetComfort,
  ): Promise<number> {
    return comfortFactorOf(await this.homeComfort.comfortOf(userId), cfg);
  }

  /**
   * 封禁账号拒绝一切养成写操作。控制器已挂 `PlayerStatusGuard`，这里再校验一次是
   * 为了兜住内部调用方（如 boost 域直接调本服务），不经过 HTTP 层。
   */
  private assertNotBanned(userId: string): Promise<void> {
    return this.playerStatus.assertNotBanned(userId);
  }

  // ---------------------------------------------------------------- 读

  /**
   * 指定宠（petId）或当前出战宠的状态。
   * 省略 petId 且该玩家一只宠都没有时，自动建一只，保证新玩家首次进入可用。
   */
  async getState(
    userId: string,
    petId?: string,
  ): Promise<{ pet: PetStateView }> {
    const t = await this.tuning();
    const pet = await this.resolvePet(userId, t, petId);
    const cf = await this.comfortFactor(userId, t.comfort);
    return {
      pet: toView(pet, settle(pet, this.clock.now(), cf, t), t),
    };
  }

  /** 我的宠物列表（结算后，只读不落库）。 */
  async list(userId: string): Promise<{ pets: PetStateView[] }> {
    const t = await this.tuning();
    const rows = await this.pets.find({
      where: { userId },
      order: { id: 'ASC' },
    });
    const now = this.clock.now();
    const cf = await this.comfortFactor(userId, t.comfort);
    return {
      pets: rows.map((p) => toView(p, settle(p, now, cf, t), t)),
    };
  }

  /**
   * 只读窥视（后台查询用）：**绝不创建**宠物，无宠返回空数组。
   * 复用同一套结算，保证后台与玩家端看到的数值一致。
   */
  async peekPets(userId: string): Promise<PetStateView[]> {
    const t = await this.tuning();
    const rows = await this.pets.find({
      where: { userId },
      order: { id: 'ASC' },
    });
    const now = this.clock.now();
    const cf = await this.comfortFactor(userId, t.comfort);
    return rows.map((p) => toView(p, settle(p, now, cf, t), t));
  }

  // ---------------------------------------------------------------- 写

  /** 新增一只宠物（受 pet.max_pets_per_user 限制；首只自动 active）。 */
  async create(
    userId: string,
    nickname?: string,
    species?: string,
  ): Promise<{ pet: PetStateView }> {
    const t = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const count = await this.pets.count({ where: { userId } });
      if (count >= t.maxPets) {
        throw new BadRequestException(`最多只能养 ${t.maxPets} 只宠物`);
      }
      const created = await this.pets.save(
        this.pets.create({
          userId,
          nickname: nickname ?? null,
          species: species ?? 'default',
          isActive: count === 0,
          hunger: 80,
          mood: 80,
          cleanliness: 80,
          stamina: staminaMaxOf(1, t.attrs),
          intimacy: 0,
          level: 1,
          exp: 0,
          lastSeenAt: this.clock.now(),
        }),
      );
      return { pet: toView(created, snapshot(created), t) };
    });
  }

  /** 切换当前出战宠（同一玩家至多一只 active）。 */
  async setActive(
    userId: string,
    petId: string,
  ): Promise<{ pet: PetStateView }> {
    const t = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const target = await this.pets.findOne({ where: { id: petId, userId } });
      if (!target) throw new NotFoundException('宠物不存在');

      await this.pets.update({ userId }, { isActive: false });
      await this.pets.update({ id: target.id }, { isActive: true });
      target.isActive = true;

      const cf = await this.comfortFactor(userId, t.comfort);
      return {
        pet: toView(target, settle(target, this.clock.now(), cf, t), t),
      };
    });
  }

  /**
   * 互动照顾（feed/bath/pet/play）。玩家级锁内串行：
   * 校验冷却 → 结算衰减 → 校验消耗 → 应用效果 → 按每日上限发放产出 → 落库 → 置冷却。
   */
  async act(
    userId: string,
    action: PetActionKey,
    bizId: string,
    petId?: string,
  ): Promise<ActionResult> {
    const t = await this.tuning();
    const cfg = t.actions[action];
    if (!cfg) throw new BadRequestException('未知互动动作');

    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const pet = await this.resolvePet(userId, t, petId);

      const cdKey = `cd:${pet.id}:${action}`;
      const remainMs = await this.redis.pttl(cdKey);
      if (remainMs > 0) {
        throw new HttpException(
          `冷却中，还需 ${Math.ceil(remainMs / 1000)} 秒`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const now = this.clock.now();
      const cur = settle(
        pet,
        now,
        await this.comfortFactor(userId, t.comfort),
        t,
      );

      // 体力类消耗需先校验，避免负数
      const staminaDelta = cfg.effects.stamina ?? 0;
      if (staminaDelta < 0 && cur.stamina < -staminaDelta) {
        throw new BadRequestException('体力不足');
      }

      const day = businessDayKey(now);
      const ttlSec = secondsUntilNextBusinessDay(now);

      const grantedIntimacy = await this.consumeDailyCap(
        userId,
        'intimacy',
        cfg.gain.intimacy,
        day,
        ttlSec,
        t.dailyCap,
      );
      const grantedExp = await this.consumeDailyCap(
        userId,
        'exp',
        cfg.gain.exp,
        day,
        ttlSec,
        t.dailyCap,
      );
      const grantedCoin = await this.consumeDailyCap(
        userId,
        'coin',
        cfg.gain.coin,
        day,
        ttlSec,
        t.dailyCap,
      );
      const capped =
        grantedIntimacy < cfg.gain.intimacy ||
        grantedExp < cfg.gain.exp ||
        grantedCoin < cfg.gain.coin;

      const exp = cur.exp + grantedExp;
      const levelBefore = levelOf(cur.exp, t.growth).level;
      const progress = levelOf(exp, t.growth);
      const staminaMax = staminaMaxOf(progress.level, t.attrs);

      pet.hunger = clampStat(cur.hunger + (cfg.effects.hunger ?? 0));
      pet.cleanliness = clampStat(
        cur.cleanliness + (cfg.effects.cleanliness ?? 0),
      );
      pet.mood = clampStat(cur.mood + (cfg.effects.mood ?? 0));
      pet.stamina = clamp(cur.stamina + staminaDelta, 0, staminaMax);
      pet.intimacy = cur.intimacy + grantedIntimacy;
      pet.exp = exp;
      pet.level = progress.level;
      pet.lastSeenAt = now;

      const saved = await this.pets.save(pet);
      await this.redis.set(cdKey, '1', 'PX', cfg.cooldownMs);

      // 每日任务进度计数（服务端权威，日切自动过期）。供 DailyService 读取。
      await this.redis.incr(`act:${userId}:${day}`);
      await this.redis.expire(`act:${userId}:${day}`, ttlSec);
      if (action === 'play') {
        await this.redis.incr(`act:${userId}:${day}:play`);
        await this.redis.expire(`act:${userId}:${day}:play`, ttlSec);
      }

      // 发放游戏币：经济域用 DB 原子记账 + (userId,bizId,pool) 持久幂等，
      // 不抢 Redis 锁，故在 pet 锁内调用安全（不会自死锁）。
      let gameCoin = 0;
      if (grantedCoin > 0) {
        const res = await this.economy.apply({
          userId,
          pool: 'game',
          delta: grantedCoin,
          bizId: `${bizId}:coin`,
          reason: 'interact',
          refId: saved.id,
        });
        gameCoin = res.wallet.gameCoin;
      } else {
        gameCoin = (await this.economy.getWallet(userId)).gameCoin;
      }

      return {
        pet: toView(saved, snapshot(saved), t),
        gained: {
          intimacy: grantedIntimacy,
          exp: grantedExp,
          coin: grantedCoin,
        },
        capped,
        levelUp: progress.level > levelBefore,
        cooldownRemainMs: cfg.cooldownMs,
        gameCoin,
      };
    });
  }

  /**
   * 后台运营补偿/纠偏：调整指定宠（或当前出战宠）的养成数值。
   * - 玩家级锁内串行，先结算到「当前」再改，避免与玩家操作竞争。
   * - mode='set' 绝对赋值；mode='delta' 在当前值上增减。
   * - 各值按上下限截断；exp 变更后 level 由曲线重算；lastSeenAt 重置为 now。
   * - **绝不建宠**：无目标宠抛 404。幂等/审计由控制器层保证。
   */
  async adminAdjust(
    userId: string,
    input: AdminAdjustInput,
  ): Promise<{ pet: PetStateView }> {
    const t = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      const pet = input.petId
        ? await this.pets.findOne({ where: { id: input.petId, userId } })
        : ((await this.pets.findOne({ where: { userId, isActive: true } })) ??
          (await this.pets.findOne({
            where: { userId },
            order: { id: 'ASC' },
          })));
      if (!pet) throw new NotFoundException('该玩家无可调整的宠物');

      const now = this.clock.now();
      const cur = settle(
        pet,
        now,
        await this.comfortFactor(userId, t.comfort),
        t,
      );
      const apply = (base: number, v: number | undefined) =>
        v === undefined ? base : input.mode === 'set' ? v : base + v;

      const exp = Math.max(0, Math.round(apply(cur.exp, input.exp)));
      const level = levelOf(exp, t.growth).level;
      const staminaMax = staminaMaxOf(level, t.attrs);

      pet.hunger = clampStat(apply(cur.hunger, input.hunger));
      pet.mood = clampStat(apply(cur.mood, input.mood));
      pet.cleanliness = clampStat(apply(cur.cleanliness, input.cleanliness));
      pet.stamina = clamp(apply(cur.stamina, input.stamina), 0, staminaMax);
      pet.intimacy = Math.max(
        0,
        Math.round(apply(cur.intimacy, input.intimacy)),
      );
      pet.exp = exp;
      pet.level = level;
      pet.lastSeenAt = now;

      const saved = await this.pets.save(pet);
      return { pet: toView(saved, snapshot(saved), t) };
    });
  }

  // ---------------------------------------------------------------- 加速/恢复

  /** 体力全恢复（付费/看广告后调用）。玩家级锁内结算后置满。 */
  async recoverStamina(
    userId: string,
    petId?: string,
  ): Promise<{ pet: PetStateView }> {
    const t = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const pet = await this.resolveExistingPet(userId, petId);
      const now = this.clock.now();
      const cur = settle(
        pet,
        now,
        await this.comfortFactor(userId, t.comfort),
        t,
      );
      const level = levelOf(cur.exp, t.growth).level;
      const staminaMax = staminaMaxOf(level, t.attrs);

      pet.hunger = cur.hunger;
      pet.cleanliness = cur.cleanliness;
      pet.mood = cur.mood;
      pet.stamina = staminaMax;
      pet.intimacy = cur.intimacy;
      pet.exp = cur.exp;
      pet.level = level;
      pet.lastSeenAt = now;
      const saved = await this.pets.save(pet);
      return { pet: toView(saved, snapshot(saved), t) };
    });
  }

  /**
   * 施加消耗品增益（由 ItemsService 在扣掉道具后调用）。
   *
   * 与 `interact` 的两点区别，都是刻意的：
   *  - **没有冷却**：冷却是「免费动作」的节流手段，消耗品已经用钱节流过了；
   *  - **不吃每日上限**：`exp` 走 `dailyCap` 的话，玩家花钱买的蛋糕会在上限用满后
   *    静默失效——花了钱没效果是最难解释的一类问题。上限是为了压制免费产出，
   *    对付费道具不适用。
   *
   * 调用方已持有 `pet:{userId}` 锁，故这里**不再抢锁**（Redis 锁不可重入，
   * 再抢一次就是自死锁）。
   */
  async applyConsumable(
    userId: string,
    effect: {
      hunger?: number;
      cleanliness?: number;
      mood?: number;
      stamina?: number;
      exp?: number;
    },
    petId?: string,
  ): Promise<{ pet: PetStateView; levelUp: boolean }> {
    const t = await this.tuning();
    const pet = await this.resolveExistingPet(userId, petId);
    const now = this.clock.now();
    const cur = settle(
      pet,
      now,
      await this.comfortFactor(userId, t.comfort),
      t,
    );

    const exp = cur.exp + (effect.exp ?? 0);
    const levelBefore = levelOf(cur.exp, t.growth).level;
    const progress = levelOf(exp, t.growth);
    const staminaMax = staminaMaxOf(progress.level, t.attrs);

    pet.hunger = clampStat(cur.hunger + (effect.hunger ?? 0));
    pet.cleanliness = clampStat(cur.cleanliness + (effect.cleanliness ?? 0));
    pet.mood = clampStat(cur.mood + (effect.mood ?? 0));
    pet.stamina = clamp(cur.stamina + (effect.stamina ?? 0), 0, staminaMax);
    pet.intimacy = cur.intimacy;
    pet.exp = exp;
    pet.level = progress.level;
    pet.lastSeenAt = now;

    const saved = await this.pets.save(pet);
    return {
      pet: toView(saved, snapshot(saved), t),
      levelUp: progress.level > levelBefore,
    };
  }

  /** 清除某宠全部互动冷却（加速道具/付费后调用）。返回清除条数。 */
  async clearCooldowns(
    userId: string,
    petId?: string,
  ): Promise<{ petId: string; cleared: number }> {
    const t = await this.tuning();
    const pet = await this.resolveExistingPet(userId, petId);
    const keys = (Object.keys(t.actions) as PetActionKey[]).map(
      (a) => `cd:${pet.id}:${a}`,
    );
    const cleared = await this.redis.del(...keys);
    return { petId: pet.id, cleared };
  }

  // ---------------------------------------------------------------- 赛跑支撑

  /** 参赛用的战斗数值快照（结算后，只读不落库、不建宠）。 */
  async getBattleStats(userId: string, petId?: string): Promise<BattleStats> {
    const t = await this.tuning();
    const pet = await this.resolveExistingPet(userId, petId);
    const cf = await this.comfortFactor(userId, t.comfort);
    const view = toView(pet, settle(pet, this.clock.now(), cf, t), t);
    return {
      petId: view.id,
      nickname: view.nickname,
      level: view.level,
      speed: view.speed,
      endurance: view.endurance,
      stamina: view.stamina,
      staminaMax: view.staminaMax,
      mood: view.mood,
    };
  }

  /**
   * 赛跑报名扣体力：玩家级锁内结算 → 校验体力 → 扣减 → 落库，
   * 返回参赛战斗数值。**绝不建宠**（无宠抛 404）。
   */
  async raceSpendStamina(
    userId: string,
    cost: number,
    petId?: string,
  ): Promise<BattleStats> {
    const t = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const pet = await this.resolveExistingPet(userId, petId);
      const now = this.clock.now();
      const cur = settle(
        pet,
        now,
        await this.comfortFactor(userId, t.comfort),
        t,
      );
      if (cur.stamina < cost) {
        throw new BadRequestException('体力不足，无法参赛');
      }

      const level = levelOf(cur.exp, t.growth).level;
      const staminaMax = staminaMaxOf(level, t.attrs);
      pet.hunger = cur.hunger;
      pet.cleanliness = cur.cleanliness;
      pet.mood = cur.mood;
      pet.stamina = clamp(cur.stamina - cost, 0, staminaMax);
      pet.intimacy = cur.intimacy;
      pet.exp = cur.exp;
      pet.level = level;
      pet.lastSeenAt = now;
      const saved = await this.pets.save(pet);

      const view = toView(saved, snapshot(saved), t);
      return {
        petId: view.id,
        nickname: view.nickname,
        level: view.level,
        speed: view.speed,
        endurance: view.endurance,
        stamina: view.stamina,
        staminaMax: view.staminaMax,
        mood: view.mood,
      };
    });
  }

  /** 定位已存在的宠（active 优先，再任意一只），无则 404——不自动建宠。 */
  private async resolveExistingPet(
    userId: string,
    petId?: string,
  ): Promise<Pet> {
    if (petId) {
      const found = await this.pets.findOne({ where: { id: petId, userId } });
      if (!found) throw new NotFoundException('宠物不存在');
      return found;
    }
    const active = await this.pets.findOne({
      where: { userId, isActive: true },
    });
    if (active) return active;
    const any = await this.pets.findOne({
      where: { userId },
      order: { id: 'ASC' },
    });
    if (!any) throw new NotFoundException('没有可参赛的宠物');
    return any;
  }

  // ---------------------------------------------------------------- 离线收益

  /**
   * 离线收益预览（只读）：按 offline_base_at 到 now 的时长（封顶 maxHours）
   * 与出战宠等级换算可领游戏币。base 缺省回退 last_seen_at → created_at。
   */
  async offlinePreview(userId: string): Promise<OfflineView> {
    const t = await this.tuning();
    const now = this.clock.now();
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('玩家不存在');
    return this.computeOffline(
      user,
      now,
      await this.activeLevel(userId, t.growth),
      t.offline,
      await this.comfortFactor(userId, t.comfort),
    );
  }

  /** 领取离线收益：发放游戏币并把 offline_base_at 前移到 now。玩家级锁串行。 */
  async offlineClaim(
    userId: string,
    bizId: string,
  ): Promise<{ gained: number; gameCoin: number }> {
    const t = await this.tuning();
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const now = this.clock.now();
      const user = await this.users.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('玩家不存在');

      const { claimableCoin } = this.computeOffline(
        user,
        now,
        await this.activeLevel(userId, t.growth),
        t.offline,
        await this.comfortFactor(userId, t.comfort),
      );
      if (claimableCoin < 1) {
        throw new BadRequestException('暂无可领取的离线收益');
      }

      const applied = await this.economy.apply({
        userId,
        pool: 'game',
        delta: claimableCoin,
        bizId,
        reason: 'offline',
        refId: null,
      });

      user.offlineBaseAt = now;
      await this.users.save(user);

      return { gained: claimableCoin, gameCoin: applied.wallet.gameCoin };
    });
  }

  /** 出战宠等级（无出战宠则退化任意一只，再退化 1 级）。 */
  private async activeLevel(
    userId: string,
    growth: PetGrowth,
  ): Promise<number> {
    const pet =
      (await this.pets.findOne({ where: { userId, isActive: true } })) ??
      (await this.pets.findOne({ where: { userId }, order: { id: 'ASC' } }));
    return pet ? levelOf(pet.exp, growth).level : 1;
  }

  private computeOffline(
    user: User,
    now: Date,
    level: number,
    cfg: PetOffline,
    comfortFactor: number,
  ): OfflineView {
    const base = user.offlineBaseAt ?? user.lastSeenAt ?? user.createdAt;
    const elapsedMs = Math.max(0, now.getTime() - new Date(base).getTime());
    const capMs = cfg.maxHours * 3_600_000;
    const cappedMs = Math.min(elapsedMs, capMs);
    const cappedH = cappedMs / 3_600_000;

    // 出战宠等级对时薪的小幅加成（level=1 无加成）
    const levelHourly = cfg.coinPerHour * (1 + (level - 1) * cfg.perLevelBonus);
    // 家园舒适度加成：与心情衰减减免同一个系数，上限即 pet.comfort.factorCap
    const coinPerHour = levelHourly * (1 + comfortFactor);
    const claimableCoin = Math.floor(cappedH * coinPerHour);

    return {
      elapsedSec: Math.floor(elapsedMs / 1000),
      cappedSec: Math.floor(cappedMs / 1000),
      maxHours: cfg.maxHours,
      coinPerHour: Math.round(coinPerHour * 10) / 10,
      comfortFactor: Math.round(comfortFactor * 100) / 100,
      claimableCoin,
    };
  }

  // ---------------------------------------------------------------- 内部

  /** 定位目标宠：显式 petId 校验归属；否则取 active，再退化到任意一只，最后自动建。 */
  private async resolvePet(
    userId: string,
    t: PetTuning,
    petId?: string,
  ): Promise<Pet> {
    if (petId) {
      const found = await this.pets.findOne({ where: { id: petId, userId } });
      if (!found) throw new NotFoundException('宠物不存在');
      return found;
    }

    const active = await this.pets.findOne({
      where: { userId, isActive: true },
    });
    if (active) return active;

    const any = await this.pets.findOne({
      where: { userId },
      order: { id: 'ASC' },
    });
    if (any) return any;

    return this.pets.save(
      this.pets.create({
        userId,
        nickname: null,
        species: 'default',
        isActive: true,
        hunger: 80,
        mood: 80,
        cleanliness: 80,
        stamina: staminaMaxOf(1, t.attrs),
        intimacy: 0,
        level: 1,
        exp: 0,
        lastSeenAt: this.clock.now(),
      }),
    );
  }

  /**
   * 按每日上限消费某类资源的额度并返回**实发量**。上限是**账号级**
   *（多宠共享同一份每日额度，防开小号式刷）。计数落 Redis，TTL 到下一个
   * 业务日切（东八区 00:00）。want<=0 直接返回 0，不触碰 Redis。
   */
  private async consumeDailyCap(
    userId: string,
    resource: DailyCapResource,
    want: number,
    day: string,
    ttlSec: number,
    cap: PetDailyCap,
  ): Promise<number> {
    if (want <= 0) return 0;
    const key = `cap:${userId}:${day}:${resource}`;
    const used = parseInt((await this.redis.get(key)) ?? '0', 10);
    const allowed = Math.max(0, cap[resource] - used);
    const grant = Math.min(want, allowed);
    if (grant > 0) {
      await this.redis.incrby(key, grant);
      await this.redis.expire(key, ttlSec);
    }
    return grant;
  }
}
