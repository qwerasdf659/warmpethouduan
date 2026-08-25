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
import { ForbiddenException } from '@nestjs/common';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { EconomyService } from '../economy/economy.service';
import { Pet } from '../entities/pet.entity';
import { User } from '../entities/user.entity';
import { HomeStat } from '../entities/home-stat.entity';
import {
  ACTIONS,
  ATTRS,
  BUSINESS_TZ_OFFSET_MS,
  comfortFactorOf,
  DAILY_CAP,
  type DailyCapResource,
  GROWTH,
  MAX_PETS_PER_USER,
  OFFLINE,
  RATE_PER_HOUR,
  STAGES,
  STAT_MAX,
  STAT_MIN,
  type PetActionKey,
} from './pet.config';

/** 结算后的宠物快照（对外出参，camelCase）。 */
export interface PetStateView {
  id: string;
  nickname: string | null;
  species: string;
  isActive: boolean;
  hunger: number;
  cleanliness: number;
  mood: number;
  stamina: number;
  staminaMax: number;
  intimacy: number;
  level: number;
  exp: number;
  /** 当前等级内已累积 exp */
  expIntoLevel: number;
  /** 升下一级还需 exp（满级为 0） */
  expToNext: number;
  stage: string;
  speed: number;
  endurance: number;
  lastSeenAt: string;
}

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

/** 惰性结算后的可变状态（纯计算产物，未落库）。 */
interface SettledStats {
  hunger: number;
  cleanliness: number;
  mood: number;
  stamina: number;
  intimacy: number;
  exp: number;
}

@Injectable()
export class PetService {
  constructor(
    @InjectRepository(Pet)
    private readonly pets: Repository<Pet>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(HomeStat)
    private readonly homeStats: Repository<HomeStat>,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly economy: EconomyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 读家园舒适度换算的心情衰减减免系数（无家园数据则 0）。 */
  private async comfortFactor(userId: string): Promise<number> {
    const stat = await this.homeStats.findOne({
      where: { userId },
      select: { comfort: true },
    });
    return comfortFactorOf(stat?.comfort ?? 0);
  }

  /** 封禁账号拒绝一切养成写操作（服务端权威，兜住存量令牌）。 */
  private async assertNotBanned(userId: string): Promise<void> {
    const u = await this.users.findOne({
      where: { id: userId },
      select: { id: true, status: true, bannedReason: true },
    });
    if (u?.status === 'banned') {
      throw new ForbiddenException(
        u.bannedReason ? `账号已被封禁：${u.bannedReason}` : '账号已被封禁',
      );
    }
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
    const pet = await this.resolvePet(userId, petId);
    const cf = await this.comfortFactor(userId);
    return { pet: this.toView(pet, this.settle(pet, this.clock.now(), cf)) };
  }

  /** 我的宠物列表（结算后，只读不落库）。 */
  async list(userId: string): Promise<{ pets: PetStateView[] }> {
    const rows = await this.pets.find({
      where: { userId },
      order: { id: 'ASC' },
    });
    const now = this.clock.now();
    const cf = await this.comfortFactor(userId);
    return { pets: rows.map((p) => this.toView(p, this.settle(p, now, cf))) };
  }

  /**
   * 只读窥视（后台查询用）：**绝不创建**宠物，无宠返回空数组。
   * 复用同一套结算，保证后台与玩家端看到的数值一致。
   */
  async peekPets(userId: string): Promise<PetStateView[]> {
    const rows = await this.pets.find({
      where: { userId },
      order: { id: 'ASC' },
    });
    const now = this.clock.now();
    const cf = await this.comfortFactor(userId);
    return rows.map((p) => this.toView(p, this.settle(p, now, cf)));
  }

  // ---------------------------------------------------------------- 写

  /** 新增一只宠物（受 MAX_PETS_PER_USER 限制；首只自动 active）。 */
  async create(
    userId: string,
    nickname?: string,
    species?: string,
  ): Promise<{ pet: PetStateView }> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const count = await this.pets.count({ where: { userId } });
      if (count >= MAX_PETS_PER_USER) {
        throw new BadRequestException(`最多只能养 ${MAX_PETS_PER_USER} 只宠物`);
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
          stamina: this.staminaMaxOf(1),
          intimacy: 0,
          level: 1,
          exp: 0,
          lastSeenAt: this.clock.now(),
        }),
      );
      return { pet: this.toView(created, this.snapshot(created)) };
    });
  }

  /** 切换当前出战宠（同一玩家至多一只 active）。 */
  async setActive(
    userId: string,
    petId: string,
  ): Promise<{ pet: PetStateView }> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const target = await this.pets.findOne({ where: { id: petId, userId } });
      if (!target) throw new NotFoundException('宠物不存在');

      await this.pets.update({ userId }, { isActive: false });
      await this.pets.update({ id: target.id }, { isActive: true });
      target.isActive = true;

      const cf = await this.comfortFactor(userId);
      return {
        pet: this.toView(target, this.settle(target, this.clock.now(), cf)),
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
    const cfg = ACTIONS[action];

    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const pet = await this.resolvePet(userId, petId);

      const cdKey = `cd:${pet.id}:${action}`;
      const remainMs = await this.redis.pttl(cdKey);
      if (remainMs > 0) {
        throw new HttpException(
          `冷却中，还需 ${Math.ceil(remainMs / 1000)} 秒`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const now = this.clock.now();
      const cur = this.settle(pet, now, await this.comfortFactor(userId));

      // 体力类消耗需先校验，避免负数
      const staminaDelta = cfg.effects.stamina ?? 0;
      if (staminaDelta < 0 && cur.stamina < -staminaDelta) {
        throw new BadRequestException('体力不足');
      }

      const day = this.businessDayKey(now);
      const ttlSec = this.secondsUntilNextBusinessDay(now);

      const grantedIntimacy = await this.consumeDailyCap(
        userId,
        'intimacy',
        cfg.gain.intimacy,
        day,
        ttlSec,
      );
      const grantedExp = await this.consumeDailyCap(
        userId,
        'exp',
        cfg.gain.exp,
        day,
        ttlSec,
      );
      const grantedCoin = await this.consumeDailyCap(
        userId,
        'coin',
        cfg.gain.coin,
        day,
        ttlSec,
      );
      const capped =
        grantedIntimacy < cfg.gain.intimacy ||
        grantedExp < cfg.gain.exp ||
        grantedCoin < cfg.gain.coin;

      const exp = cur.exp + grantedExp;
      const levelBefore = this.levelOf(cur.exp).level;
      const progress = this.levelOf(exp);
      const staminaMax = this.staminaMaxOf(progress.level);

      pet.hunger = this.clampStat(cur.hunger + (cfg.effects.hunger ?? 0));
      pet.cleanliness = this.clampStat(
        cur.cleanliness + (cfg.effects.cleanliness ?? 0),
      );
      pet.mood = this.clampStat(cur.mood + (cfg.effects.mood ?? 0));
      pet.stamina = this.clamp(cur.stamina + staminaDelta, 0, staminaMax);
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
        pet: this.toView(saved, this.snapshot(saved)),
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
      const cur = this.settle(pet, now, await this.comfortFactor(userId));
      const apply = (base: number, v: number | undefined) =>
        v === undefined ? base : input.mode === 'set' ? v : base + v;

      const exp = Math.max(0, Math.round(apply(cur.exp, input.exp)));
      const level = this.levelOf(exp).level;
      const staminaMax = this.staminaMaxOf(level);

      pet.hunger = this.clampStat(apply(cur.hunger, input.hunger));
      pet.mood = this.clampStat(apply(cur.mood, input.mood));
      pet.cleanliness = this.clampStat(
        apply(cur.cleanliness, input.cleanliness),
      );
      pet.stamina = this.clamp(
        apply(cur.stamina, input.stamina),
        0,
        staminaMax,
      );
      pet.intimacy = Math.max(
        0,
        Math.round(apply(cur.intimacy, input.intimacy)),
      );
      pet.exp = exp;
      pet.level = level;
      pet.lastSeenAt = now;

      const saved = await this.pets.save(pet);
      return { pet: this.toView(saved, this.snapshot(saved)) };
    });
  }

  // ---------------------------------------------------------------- 加速/恢复

  /** 体力全恢复（付费/看广告后调用）。玩家级锁内结算后置满。 */
  async recoverStamina(
    userId: string,
    petId?: string,
  ): Promise<{ pet: PetStateView }> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const pet = await this.resolveExistingPet(userId, petId);
      const now = this.clock.now();
      const cur = this.settle(pet, now, await this.comfortFactor(userId));
      const level = this.levelOf(cur.exp).level;
      const staminaMax = this.staminaMaxOf(level);

      pet.hunger = cur.hunger;
      pet.cleanliness = cur.cleanliness;
      pet.mood = cur.mood;
      pet.stamina = staminaMax;
      pet.intimacy = cur.intimacy;
      pet.exp = cur.exp;
      pet.level = level;
      pet.lastSeenAt = now;
      const saved = await this.pets.save(pet);
      return { pet: this.toView(saved, this.snapshot(saved)) };
    });
  }

  /** 清除某宠全部互动冷却（加速道具/付费后调用）。返回清除条数。 */
  async clearCooldowns(
    userId: string,
    petId?: string,
  ): Promise<{ petId: string; cleared: number }> {
    const pet = await this.resolveExistingPet(userId, petId);
    const keys = (Object.keys(ACTIONS) as PetActionKey[]).map(
      (a) => `cd:${pet.id}:${a}`,
    );
    const cleared = await this.redis.del(...keys);
    return { petId: pet.id, cleared };
  }

  // ---------------------------------------------------------------- 赛跑支撑

  /** 参赛用的战斗数值快照（结算后，只读不落库、不建宠）。 */
  async getBattleStats(userId: string, petId?: string): Promise<BattleStats> {
    const pet = await this.resolveExistingPet(userId, petId);
    const cf = await this.comfortFactor(userId);
    const view = this.toView(pet, this.settle(pet, this.clock.now(), cf));
    return {
      petId: view.id,
      nickname: view.nickname,
      level: view.level,
      speed: view.speed,
      endurance: view.endurance,
      stamina: view.stamina,
      staminaMax: view.staminaMax,
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
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const pet = await this.resolveExistingPet(userId, petId);
      const now = this.clock.now();
      const cur = this.settle(pet, now, await this.comfortFactor(userId));
      if (cur.stamina < cost) {
        throw new BadRequestException('体力不足，无法参赛');
      }

      const level = this.levelOf(cur.exp).level;
      const staminaMax = this.staminaMaxOf(level);
      pet.hunger = cur.hunger;
      pet.cleanliness = cur.cleanliness;
      pet.mood = cur.mood;
      pet.stamina = this.clamp(cur.stamina - cost, 0, staminaMax);
      pet.intimacy = cur.intimacy;
      pet.exp = cur.exp;
      pet.level = level;
      pet.lastSeenAt = now;
      const saved = await this.pets.save(pet);

      const view = this.toView(saved, this.snapshot(saved));
      return {
        petId: view.id,
        nickname: view.nickname,
        level: view.level,
        speed: view.speed,
        endurance: view.endurance,
        stamina: view.stamina,
        staminaMax: view.staminaMax,
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
  async offlinePreview(userId: string): Promise<{
    elapsedSec: number;
    cappedSec: number;
    maxHours: number;
    coinPerHour: number;
    claimableCoin: number;
  }> {
    const now = this.clock.now();
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('玩家不存在');
    return this.computeOffline(user, now, await this.activeLevel(userId));
  }

  /** 领取离线收益：发放游戏币并把 offline_base_at 前移到 now。玩家级锁串行。 */
  async offlineClaim(
    userId: string,
    bizId: string,
  ): Promise<{ gained: number; gameCoin: number }> {
    return this.lock.withLock(`pet:${userId}`, async () => {
      await this.assertNotBanned(userId);
      const now = this.clock.now();
      const user = await this.users.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('玩家不存在');

      const { claimableCoin } = this.computeOffline(
        user,
        now,
        await this.activeLevel(userId),
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
  private async activeLevel(userId: string): Promise<number> {
    const pet =
      (await this.pets.findOne({ where: { userId, isActive: true } })) ??
      (await this.pets.findOne({ where: { userId }, order: { id: 'ASC' } }));
    return pet ? this.levelOf(pet.exp).level : 1;
  }

  private computeOffline(
    user: User,
    now: Date,
    level: number,
  ): {
    elapsedSec: number;
    cappedSec: number;
    maxHours: number;
    coinPerHour: number;
    claimableCoin: number;
  } {
    const base = user.offlineBaseAt ?? user.lastSeenAt ?? user.createdAt;
    const elapsedMs = Math.max(0, now.getTime() - new Date(base).getTime());
    const capMs = OFFLINE.maxHours * 3_600_000;
    const cappedMs = Math.min(elapsedMs, capMs);
    const cappedH = cappedMs / 3_600_000;

    // 出战宠等级对时薪的小幅加成（level=1 无加成）
    const coinPerHour =
      OFFLINE.coinPerHour * (1 + (level - 1) * OFFLINE.perLevelBonus);
    const claimableCoin = Math.floor(cappedH * coinPerHour);

    return {
      elapsedSec: Math.floor(elapsedMs / 1000),
      cappedSec: Math.floor(cappedMs / 1000),
      maxHours: OFFLINE.maxHours,
      coinPerHour: Math.round(coinPerHour * 10) / 10,
      claimableCoin,
    };
  }

  // ---------------------------------------------------------------- 内部

  /** 定位目标宠：显式 petId 校验归属；否则取 active，再退化到任意一只，最后自动建。 */
  private async resolvePet(userId: string, petId?: string): Promise<Pet> {
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
        stamina: this.staminaMaxOf(1),
        intimacy: 0,
        level: 1,
        exp: 0,
        lastSeenAt: this.clock.now(),
      }),
    );
  }

  /**
   * 惰性结算：把库里的值按 elapsed 推进到「当前」。纯函数、不落库。
   *
   * 心情为派生量：基础 −2/h；饱食度或清洁度触底后的那段时间再额外 −3/h；
   * 整体再乘 (1 − comfortFactor)（家园未接线前 comfortFactor = 0）。
   */
  private settle(pet: Pet, now: Date, comfortFactor = 0): SettledStats {
    const elapsedH = Math.max(
      0,
      (now.getTime() - new Date(pet.lastSeenAt).getTime()) / 3_600_000,
    );

    const hunger = this.clampStat(pet.hunger - RATE_PER_HOUR.hunger * elapsedH);
    const cleanliness = this.clampStat(
      pet.cleanliness - RATE_PER_HOUR.cleanliness * elapsedH,
    );

    // 各自触底所需小时数 → 取更早触底者，之后的时长按「饿/脏」加速掉心情
    const hungerZeroH = pet.hunger / RATE_PER_HOUR.hunger;
    const cleanZeroH = pet.cleanliness / RATE_PER_HOUR.cleanliness;
    const starvingH = Math.max(0, elapsedH - Math.min(hungerZeroH, cleanZeroH));
    const moodDecay =
      (RATE_PER_HOUR.moodBase * elapsedH +
        RATE_PER_HOUR.moodStarving * starvingH) *
      (1 - comfortFactor);

    const staminaMax = this.staminaMaxOf(this.levelOf(pet.exp).level);

    return {
      hunger,
      cleanliness,
      mood: this.clampStat(pet.mood - moodDecay),
      stamina: this.clamp(
        pet.stamina + RATE_PER_HOUR.stamina * elapsedH,
        0,
        staminaMax,
      ),
      intimacy: pet.intimacy,
      exp: pet.exp,
    };
  }

  /** 刚落库后的快照（无需再衰减）。 */
  private snapshot(pet: Pet): SettledStats {
    return {
      hunger: pet.hunger,
      cleanliness: pet.cleanliness,
      mood: pet.mood,
      stamina: pet.stamina,
      intimacy: pet.intimacy,
      exp: pet.exp,
    };
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
  ): Promise<number> {
    if (want <= 0) return 0;
    const key = `cap:${userId}:${day}:${resource}`;
    const used = parseInt((await this.redis.get(key)) ?? '0', 10);
    const allowed = Math.max(0, DAILY_CAP[resource] - used);
    const grant = Math.min(want, allowed);
    if (grant > 0) {
      await this.redis.incrby(key, grant);
      await this.redis.expire(key, ttlSec);
    }
    return grant;
  }

  /** 业务日键（东八区），形如 20260825。 */
  private businessDayKey(now: Date): string {
    const shifted = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS);
    const y = shifted.getUTCFullYear();
    const m = `${shifted.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${shifted.getUTCDate()}`.padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /** 距下一个东八区 00:00 的秒数。 */
  private secondsUntilNextBusinessDay(now: Date): number {
    const shifted = now.getTime() + BUSINESS_TZ_OFFSET_MS;
    const dayMs = 86_400_000;
    return Math.ceil((dayMs - (shifted % dayMs)) / 1000);
  }

  /** 由累计 exp 推出等级与本级进度（曲线：base=100，每级 ×1.2）。 */
  private levelOf(totalExp: number): {
    level: number;
    expIntoLevel: number;
    expToNext: number;
  } {
    let level = 1;
    let need: number = GROWTH.baseExp;
    let remaining = Math.max(0, totalExp);

    while (level < GROWTH.maxLevel && remaining >= need) {
      remaining -= need;
      level += 1;
      need = Math.round(need * GROWTH.ratio);
    }

    return {
      level,
      expIntoLevel: remaining,
      expToNext: level >= GROWTH.maxLevel ? 0 : need - remaining,
    };
  }

  private staminaMaxOf(level: number): number {
    return ATTRS.staminaMaxBase + ATTRS.staminaMaxPerLevel * (level - 1);
  }

  private stageOf(level: number): string {
    return (
      STAGES.find((s) => level <= s.maxLevel)?.key ??
      STAGES[STAGES.length - 1].key
    );
  }

  private toView(pet: Pet, s: SettledStats): PetStateView {
    const progress = this.levelOf(s.exp);
    const level = progress.level;
    return {
      id: pet.id,
      nickname: pet.nickname,
      species: pet.species,
      isActive: pet.isActive,
      hunger: s.hunger,
      cleanliness: s.cleanliness,
      mood: s.mood,
      stamina: s.stamina,
      staminaMax: this.staminaMaxOf(level),
      intimacy: s.intimacy,
      level,
      exp: s.exp,
      expIntoLevel: progress.expIntoLevel,
      expToNext: progress.expToNext,
      stage: this.stageOf(level),
      speed: this.round1(ATTRS.speedBase + ATTRS.speedPerLevel * (level - 1)),
      endurance: this.round1(
        ATTRS.enduranceBase + ATTRS.endurancePerLevel * (level - 1),
      ),
      lastSeenAt: new Date(pet.lastSeenAt).toISOString(),
    };
  }

  private clampStat(v: number): number {
    return this.clamp(v, STAT_MIN, STAT_MAX);
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  private round1(v: number): number {
    return Math.round(v * 10) / 10;
  }
}
