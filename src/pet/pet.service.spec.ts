import { Pet } from '../entities/pet.entity';
import { User } from '../entities/user.entity';
import { DAILY_CAP, OFFLINE } from './pet.config';
import { PetService } from './pet.service';

/**
 * 聚焦 PetService 的**纯结算逻辑**（惰性衰减、离线收益、每日上限）：
 * 这些方法不依赖 DB/Redis 之外的东西，故用最小桩注入即可断言数值正确性。
 */
describe('PetService 结算', () => {
  const HOUR = 3_600_000;

  function makeService(redis?: any): PetService {
    // 结算相关方法只用到 redis（consumeDailyCap）与纯计算，其余依赖传 null。
    return new PetService(
      null as any, // pets
      null as any, // users
      null as any, // homeStats
      { now: () => new Date(), nowMs: () => Date.now() }, // clock
      null as any, // lock
      null as any, // economy
      redis, // redis
    );
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

      const s = (svc as any).settle(pet, now, 0);

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

      const s = (svc as any).settle(pet, now, 0);
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

      const s = (svc as any).settle(pet, now, 0.5);
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

      const s = (svc as any).settle(pet, now, 0);
      expect(s.hunger).toBe(80);
      expect(s.mood).toBe(80);
    });
  });

  describe('computeOffline 离线收益', () => {
    it('按时长线性发放（level=1 无加成）', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T02:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 2 * HOUR),
      } as unknown as User;

      const r = (svc as any).computeOffline(user, now, 1);
      expect(r.coinPerHour).toBe(OFFLINE.coinPerHour);
      expect(r.claimableCoin).toBe(2 * OFFLINE.coinPerHour);
    });

    it('超过封顶按 maxHours 截断（防挂机）', () => {
      const svc = makeService();
      const now = new Date('2026-01-02T00:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 100 * HOUR),
      } as unknown as User;

      const r = (svc as any).computeOffline(user, now, 1);
      expect(r.maxHours).toBe(OFFLINE.maxHours);
      expect(r.claimableCoin).toBe(OFFLINE.maxHours * OFFLINE.coinPerHour);
    });

    it('出战宠等级提升时薪', () => {
      const svc = makeService();
      const now = new Date('2026-01-01T02:00:00Z');
      const user = {
        offlineBaseAt: new Date(now.getTime() - 2 * HOUR),
      } as unknown as User;

      const r = (svc as any).computeOffline(user, now, 5);
      const expectedPerHour =
        OFFLINE.coinPerHour * (1 + 4 * OFFLINE.perLevelBonus);
      expect(r.claimableCoin).toBe(Math.floor(2 * expectedPerHour));
    });
  });

  describe('consumeDailyCap 每日上限', () => {
    it('未达上限：全额发放并累加计数', async () => {
      const store: Record<string, string> = {};
      const redis = {
        get: jest.fn(async (k: string) => store[k] ?? null),
        incrby: jest.fn(async (k: string, n: number) => {
          store[k] = String((parseInt(store[k] ?? '0', 10) || 0) + n);
          return Number(store[k]);
        }),
        expire: jest.fn(async () => 1),
      };
      const svc = makeService(redis);

      const grant = await (svc as any).consumeDailyCap(
        'u1',
        'coin',
        10,
        '20260101',
        3600,
      );
      expect(grant).toBe(10);
      expect(redis.incrby).toHaveBeenCalledWith('cap:u1:20260101:coin', 10);
    });

    it('接近上限：截断到剩余额度', async () => {
      const used = DAILY_CAP.coin - 3;
      const redis = {
        get: jest.fn(async () => String(used)),
        incrby: jest.fn(async () => used + 3),
        expire: jest.fn(async () => 1),
      };
      const svc = makeService(redis);

      const grant = await (svc as any).consumeDailyCap(
        'u1',
        'coin',
        10,
        '20260101',
        3600,
      );
      expect(grant).toBe(3);
    });

    it('已达上限：发放 0 且不触碰 Redis 写', async () => {
      const redis = {
        get: jest.fn(async () => String(DAILY_CAP.coin)),
        incrby: jest.fn(),
        expire: jest.fn(),
      };
      const svc = makeService(redis);

      const grant = await (svc as any).consumeDailyCap(
        'u1',
        'coin',
        10,
        '20260101',
        3600,
      );
      expect(grant).toBe(0);
      expect(redis.incrby).not.toHaveBeenCalled();
    });

    it('want<=0 直接返回 0，不读 Redis', async () => {
      const redis = { get: jest.fn(), incrby: jest.fn(), expire: jest.fn() };
      const svc = makeService(redis);

      const grant = await (svc as any).consumeDailyCap(
        'u1',
        'coin',
        0,
        '20260101',
        3600,
      );
      expect(grant).toBe(0);
      expect(redis.get).not.toHaveBeenCalled();
    });
  });

  describe('levelOf 成长曲线', () => {
    it('exp=0 → Lv1', () => {
      const svc = makeService();
      expect((svc as any).levelOf(0).level).toBe(1);
    });

    it('exp=100 → Lv2 起步', () => {
      const svc = makeService();
      const r = (svc as any).levelOf(100);
      expect(r.level).toBe(2);
      expect(r.expIntoLevel).toBe(0);
    });
  });
});
