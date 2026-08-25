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
import { PetService, type PetTuning } from './pet.service';

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
  ): {
    maxHours: number;
    coinPerHour: number;
    claimableCoin: number;
  };
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

      const r = svc.computeOffline(user, now, 1, OFFLINE);
      expect(r.coinPerHour).toBe(OFFLINE.coinPerHour);
      expect(r.claimableCoin).toBe(2 * OFFLINE.coinPerHour);
    });

    it('超过封顶按 maxHours 截断（防挂机）', () => {
      const svc = makeService();
      const now = new Date('2026-01-02T00:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 100 * HOUR),
      } as unknown as User;

      const r = svc.computeOffline(user, now, 1, OFFLINE);
      expect(r.maxHours).toBe(OFFLINE.maxHours);
      expect(r.claimableCoin).toBe(OFFLINE.maxHours * OFFLINE.coinPerHour);
    });

    it('出战宠等级提升时薪', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T02:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 2 * HOUR),
      } as unknown as User;

      const r = svc.computeOffline(user, now, 5, OFFLINE);
      const expectedPerHour =
        OFFLINE.coinPerHour * (1 + 4 * OFFLINE.perLevelBonus);
      expect(r.claimableCoin).toBe(Math.floor(2 * expectedPerHour));
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
