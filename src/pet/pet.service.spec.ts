import Redis from 'ioredis';
import { Pet } from '../entities/pet.entity';
import { User } from '../entities/user.entity';
import {
  PET_CONFIG,
  type DailyCapResource,
  type PetDailyCap,
  type PetGrowth,
  type PetOffline,
} from './pet.config';
import { PetService, type OfflineView, type PetTuning } from './pet.service';

/**
 * 聚焦 PetService 的**纯结算逻辑**（惰性衰减、离线收益、每日上限）：
 * 这些方法不依赖 DB/Redis 之外的东西，故用最小桩注入即可断言数值正确性。
 */

/** 待测的私有计算方法。显式声明形状而不用 `as any`，改签名时编译器能立刻抓到。 */
interface PetInternals {
  settle(
    pet: Pet,
    now: Date,
    comfortFactor: number,
    t: PetTuning,
  ): {
    hunger: number;
    cleanliness: number;
    mood: number;
    stamina: number;
    intimacy: number;
    exp: number;
  };
  computeOffline(
    user: User,
    now: Date,
    level: number,
    cfg: PetOffline,
    comfortFactor: number,
  ): OfflineView;
  consumeDailyCap(
    userId: string,
    resource: DailyCapResource,
    want: number,
    day: string,
    ttlSec: number,
    cap: PetDailyCap,
  ): Promise<number>;
  levelOf(
    totalExp: number,
    growth: PetGrowth,
  ): { level: number; expIntoLevel: number; expToNext: number };
}

/** 断言基准取代码内置默认值，与线上未改配置时的行为一致。 */
const T: PetTuning = {
  rates: PET_CONFIG['pet.rates'].default,
  growth: PET_CONFIG['pet.growth'].default,
  attrs: PET_CONFIG['pet.attrs'].default,
  stages: PET_CONFIG['pet.stages'].default,
  actions: PET_CONFIG['pet.actions'].default,
  dailyCap: PET_CONFIG['pet.daily_cap'].default,
  maxPets: PET_CONFIG['pet.max_pets_per_user'].default,
  offline: PET_CONFIG['pet.offline'].default,
  comfort: PET_CONFIG['pet.comfort'].default,
};

const OFFLINE = T.offline;
const DAILY_CAP = T.dailyCap;

interface RedisStub {
  get: jest.Mock;
  incrby: jest.Mock;
  expire: jest.Mock;
}

describe('PetService 结算', () => {
  const HOUR = 3_600_000;

  function makeService(redis?: RedisStub): PetInternals {
    // 结算相关方法只用到 redis（consumeDailyCap）与纯计算，其余依赖传 null。
    const svc = new PetService(
      null as never, // pets
      null as never, // users
      null as never, // homeStats
      { now: () => new Date(), nowMs: () => Date.now() }, // clock
      null as never, // lock
      null as never, // economy
      null as never, // playerStatus
      null as never, // config（测试直接传 tuning，不走配置服务）
      redis as unknown as Redis,
    );
    return svc as unknown as PetInternals;
  }

  describe('settle 惰性衰减', () => {
    it('按 elapsed 推进各状态（1 小时）', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T01:00:00Z');
      const pet = {
        hunger: 80,
        cleanliness: 80,
        mood: 80,
        stamina: 50,
        intimacy: 10,
        exp: 0,
        lastSeenAt: new Date(now.getTime() - HOUR),
      } as unknown as Pet;

      const s = svc.settle(pet, now, 0, T);

      expect(s.hunger).toBe(75); // -5/h
      expect(s.cleanliness).toBe(77); // -3/h
      expect(s.mood).toBe(78); // -2/h 基础，未触底
      expect(s.stamina).toBe(60); // +10/h
      expect(s.intimacy).toBe(10); // 不衰减
    });

    it('触底后心情加速衰减', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T20:00:00Z');
      const pet = {
        hunger: 10, // 2h 后饿到 0
        cleanliness: 90,
        mood: 100,
        stamina: 0,
        intimacy: 0,
        exp: 0,
        lastSeenAt: new Date(now.getTime() - 10 * HOUR),
      } as unknown as Pet;

      const s = svc.settle(pet, now, 0, T);
      // hungerZeroH=2，starvingH=8 → moodDecay=2*10 + 3*8 = 44 → mood=56
      expect(s.mood).toBe(56);
    });

    it('comfortFactor 减免心情衰减', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T01:00:00Z');
      const pet = {
        hunger: 80,
        cleanliness: 80,
        mood: 80,
        stamina: 50,
        intimacy: 0,
        exp: 0,
        lastSeenAt: new Date(now.getTime() - HOUR),
      } as unknown as Pet;

      const s = svc.settle(pet, now, 0.5, T);
      // moodDecay = 2 * (1-0.5) = 1 → mood=79
      expect(s.mood).toBe(79);
    });

    it('elapsed 为负（时钟回拨）不倒增', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T00:00:00Z');
      const pet = {
        hunger: 80,
        cleanliness: 80,
        mood: 80,
        stamina: 50,
        intimacy: 0,
        exp: 0,
        lastSeenAt: new Date(now.getTime() + HOUR),
      } as unknown as Pet;

      const s = svc.settle(pet, now, 0, T);
      expect(s.hunger).toBe(80);
      expect(s.mood).toBe(80);
    });

    it('衰减速率配成 0 时不触底、不产生 NaN', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T10:00:00Z');
      const pet = {
        hunger: 0,
        cleanliness: 0,
        mood: 80,
        stamina: 0,
        intimacy: 0,
        exp: 0,
        lastSeenAt: new Date(now.getTime() - 10 * HOUR),
      } as unknown as Pet;

      const zeroRates: PetTuning = {
        ...T,
        rates: { ...T.rates, hunger: 0, cleanliness: 0 },
      };
      const s = svc.settle(pet, now, 0, zeroRates);
      // 永不触底 → 只有基础衰减 2/h * 10h = 20 → mood=60
      expect(s.mood).toBe(60);
    });
  });

  describe('computeOffline 离线收益', () => {
    it('按时长线性发放（level=1 无加成）', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T02:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 2 * HOUR),
      } as unknown as User;

      const r = svc.computeOffline(user, now, 1, OFFLINE, 0);
      expect(r.coinPerHour).toBe(OFFLINE.coinPerHour);
      expect(r.claimableCoin).toBe(2 * OFFLINE.coinPerHour);
    });

    it('超过封顶按 maxHours 截断（防挂机）', () => {
      const svc = makeService();
      const now = new Date('2026-01-02T00:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 100 * HOUR),
      } as unknown as User;

      const r = svc.computeOffline(user, now, 1, OFFLINE, 0);
      expect(r.maxHours).toBe(OFFLINE.maxHours);
      expect(r.claimableCoin).toBe(OFFLINE.maxHours * OFFLINE.coinPerHour);
    });

    it('出战宠等级提升时薪', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T02:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 2 * HOUR),
      } as unknown as User;

      const r = svc.computeOffline(user, now, 5, OFFLINE, 0);
      const expectedPerHour =
        OFFLINE.coinPerHour * (1 + 4 * OFFLINE.perLevelBonus);
      expect(r.claimableCoin).toBe(Math.floor(2 * expectedPerHour));
    });

    it('家园舒适度提升时薪（与心情衰减减免同一系数）', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T02:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 2 * HOUR),
      } as unknown as User;

      const plain = svc.computeOffline(user, now, 1, OFFLINE, 0);
      const cozy = svc.computeOffline(user, now, 1, OFFLINE, 0.3);

      expect(cozy.comfortFactor).toBe(0.3);
      expect(cozy.coinPerHour).toBe(OFFLINE.coinPerHour * 1.3);
      expect(cozy.claimableCoin).toBe(
        Math.floor(2 * OFFLINE.coinPerHour * 1.3),
      );
      expect(cozy.claimableCoin).toBeGreaterThan(plain.claimableCoin);
    });

    it('封顶后家园加成仍生效（加成作用于时薪，不是绕过 CAP）', () => {
      const svc = makeService();
      const now = new Date('2026-01-02T00:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 100 * HOUR),
      } as unknown as User;

      const r = svc.computeOffline(user, now, 1, OFFLINE, 0.3);
      expect(r.cappedSec).toBe(OFFLINE.maxHours * 3600);
      expect(r.claimableCoin).toBe(
        Math.floor(OFFLINE.maxHours * OFFLINE.coinPerHour * 1.3),
      );
    });
  });

  describe('consumeDailyCap 每日上限', () => {
    it('未达上限：全额发放并累加计数', async () => {
      const store: Record<string, string> = {};
      const redis: RedisStub = {
        get: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
        incrby: jest.fn((k: string, n: number) => {
          store[k] = String((parseInt(store[k] ?? '0', 10) || 0) + n);
          return Promise.resolve(Number(store[k]));
        }),
        expire: jest.fn(() => Promise.resolve(1)),
      };
      const svc = makeService(redis);

      const grant = await svc.consumeDailyCap(
        'u1',
        'coin',
        10,
        '20260101',
        3600,
        DAILY_CAP,
      );
      expect(grant).toBe(10);
      expect(redis.incrby).toHaveBeenCalledWith('cap:u1:20260101:coin', 10);
    });

    it('接近上限：截断到剩余额度', async () => {
      const used = DAILY_CAP.coin - 3;
      const redis: RedisStub = {
        get: jest.fn(() => Promise.resolve(String(used))),
        incrby: jest.fn(() => Promise.resolve(used + 3)),
        expire: jest.fn(() => Promise.resolve(1)),
      };
      const svc = makeService(redis);

      const grant = await svc.consumeDailyCap(
        'u1',
        'coin',
        10,
        '20260101',
        3600,
        DAILY_CAP,
      );
      expect(grant).toBe(3);
    });

    it('已达上限：发放 0 且不触碰 Redis 写', async () => {
      const redis: RedisStub = {
        get: jest.fn(() => Promise.resolve(String(DAILY_CAP.coin))),
        incrby: jest.fn(),
        expire: jest.fn(),
      };
      const svc = makeService(redis);

      const grant = await svc.consumeDailyCap(
        'u1',
        'coin',
        10,
        '20260101',
        3600,
        DAILY_CAP,
      );
      expect(grant).toBe(0);
      expect(redis.incrby).not.toHaveBeenCalled();
    });

    it('want<=0 直接返回 0，不读 Redis', async () => {
      const redis: RedisStub = {
        get: jest.fn(),
        incrby: jest.fn(),
        expire: jest.fn(),
      };
      const svc = makeService(redis);

      const grant = await svc.consumeDailyCap(
        'u1',
        'coin',
        0,
        '20260101',
        3600,
        DAILY_CAP,
      );
      expect(grant).toBe(0);
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('上限被运营改小后立即按新值截断', async () => {
      const redis: RedisStub = {
        get: jest.fn(() => Promise.resolve('0')),
        incrby: jest.fn(() => Promise.resolve(5)),
        expire: jest.fn(() => Promise.resolve(1)),
      };
      const svc = makeService(redis);

      const grant = await svc.consumeDailyCap(
        'u1',
        'coin',
        10,
        '20260101',
        3600,
        { ...DAILY_CAP, coin: 5 },
      );
      expect(grant).toBe(5);
    });
  });

  describe('levelOf 成长曲线', () => {
    it('exp=0 → Lv1', () => {
      const svc = makeService();
      expect(svc.levelOf(0, T.growth).level).toBe(1);
    });

    it('exp=100 → Lv2 起步', () => {
      const svc = makeService();
      const r = svc.levelOf(100, T.growth);
      expect(r.level).toBe(2);
      expect(r.expIntoLevel).toBe(0);
    });

    it('曲线参数可配：baseExp 改小则同样 exp 升到更高级', () => {
      const svc = makeService();
      const cheap = { ...T.growth, baseExp: 10 };
      expect(svc.levelOf(100, cheap).level).toBeGreaterThan(
        svc.levelOf(100, T.growth).level,
      );
    });
  });
});

/**
 * 消耗品增益：与 `interact` 的两点差别（不吃冷却、不吃每日上限）是刻意的，
 * 也最容易在后续重构中被「顺手统一」掉，故单独钉住。
 */
describe('PetService.applyConsumable', () => {
  /** 结算基准时刻固定，避免衰减把断言搅成范围判断。 */
  const NOW = new Date('2026-01-01T00:00:00Z');

  function makeService(petOverrides: Partial<Pet> = {}) {
    const pet = {
      id: 'p1',
      userId: '7',
      nickname: '球球',
      species: 'cat',
      isActive: true,
      hunger: 50,
      cleanliness: 50,
      mood: 50,
      stamina: 20,
      intimacy: 10,
      exp: 0,
      level: 1,
      lastSeenAt: NOW,
      ...petOverrides,
    } as Pet;

    const pets = {
      findOne: jest.fn().mockResolvedValue(pet),
      save: jest.fn((p: Pet) => Promise.resolve(p)),
    };
    const svc = new PetService(
      pets as never,
      null as never, // users
      { findOne: jest.fn().mockResolvedValue(null) } as never, // homeStats
      { now: () => NOW, nowMs: () => NOW.getTime() },
      null as never, // lock：applyConsumable 刻意不抢锁，调用方已持有
      null as never, // economy
      null as never, // playerStatus
      {
        snapshot: jest.fn().mockResolvedValue({
          'pet.rates': T.rates,
          'pet.growth': T.growth,
          'pet.attrs': T.attrs,
          'pet.stages': T.stages,
          'pet.actions': T.actions,
          'pet.daily_cap': T.dailyCap,
          'pet.max_pets_per_user': T.maxPets,
          'pet.offline': T.offline,
          'pet.comfort': T.comfort,
        }),
      } as never,
      null as never, // redis
    );
    return { svc, pets, pet };
  }

  it('把各项增益加到当前状态上', async () => {
    const { svc } = makeService();

    const res = await svc.applyConsumable('7', {
      hunger: 25,
      cleanliness: 10,
      mood: 20,
    });

    expect(res.pet.hunger).toBe(75);
    expect(res.pet.cleanliness).toBe(60);
    expect(res.pet.mood).toBe(70);
  });

  it('状态封顶到 100，不会溢出', async () => {
    const { svc } = makeService({ hunger: 95 });
    const res = await svc.applyConsumable('7', { hunger: 25 });
    expect(res.pet.hunger).toBe(100);
  });

  it('体力封顶到当前等级的上限', async () => {
    const { svc } = makeService();
    const res = await svc.applyConsumable('7', { stamina: 999 });
    expect(res.pet.stamina).toBe(res.pet.staminaMax);
  });

  it('经验触发升级时返回 levelUp', async () => {
    const { svc } = makeService();

    const flat = await svc.applyConsumable('7', { exp: 10 });
    expect(flat.levelUp).toBe(false);

    const up = await svc.applyConsumable('7', { exp: 10_000 });
    expect(up.levelUp).toBe(true);
    expect(up.pet.level).toBeGreaterThan(1);
  });

  it('缺省的字段不动对应状态', async () => {
    const { svc } = makeService();
    const res = await svc.applyConsumable('7', { hunger: 10 });
    expect(res.pet.cleanliness).toBe(50);
    expect(res.pet.mood).toBe(50);
    expect(res.pet.intimacy).toBe(10);
  });

  it('既不吃每日上限也不写冷却：付费道具不该被免费产出的节流手段限制', async () => {
    // redis 传的是 null，无论碰限额计数器还是冷却键都会抛 —— 能跑通即证明两者都没走
    const { svc } = makeService();
    await expect(svc.applyConsumable('7', { exp: 500 })).resolves.toBeDefined();
  });

  it('效果全空时状态原样不动（脏配置兜底，正常由调用方拦在前面）', async () => {
    const { svc } = makeService();
    const res = await svc.applyConsumable('7', {});
    expect(res.pet.hunger).toBe(50);
    expect(res.pet.exp).toBe(0);
    expect(res.levelUp).toBe(false);
  });

  it('可指定 petId（多宠场景）', async () => {
    const { svc, pets } = makeService();
    await svc.applyConsumable('7', { hunger: 1 }, 'p2');
    expect(pets.findOne).toHaveBeenCalledWith({
      where: { id: 'p2', userId: '7' },
    });
  });

  it('宠物不存在时报错', async () => {
    const { svc, pets } = makeService();
    pets.findOne.mockResolvedValue(null);
    await expect(
      svc.applyConsumable('7', { hunger: 1 }, 'p9'),
    ).rejects.toThrow();
  });
});
