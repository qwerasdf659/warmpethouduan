import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { LoginThrottleService } from './login-throttle.service';

/** 桩只声明用到的命令：读计数走 get，记失败走 incr/expire，清零走 del。 */
type RedisStub = Partial<Record<'get' | 'incr' | 'expire' | 'del', jest.Mock>>;

describe('LoginThrottleService', () => {
  const IP = '203.0.113.7';
  const USER = '13612227910';

  function makeService(redis: RedisStub): LoginThrottleService {
    return new LoginThrottleService(redis as unknown as Redis);
  }

  /** 按键返回不同计数，用来分别驱动账号维度与 IP 维度的阈值。 */
  function counters(map: Record<string, number>): RedisStub {
    return {
      get: jest.fn((key: string) =>
        Promise.resolve(map[key]?.toString() ?? null),
      ),
      incr: jest.fn(() => Promise.resolve(1)),
      expire: jest.fn(() => Promise.resolve(1)),
      del: jest.fn(() => Promise.resolve(1)),
    };
  }

  describe('assertNotLocked 阈值', () => {
    it('无历史失败时放行', async () => {
      await expect(
        makeService(counters({})).assertNotLocked(USER, IP),
      ).resolves.toBeUndefined();
    });

    it('账号失败 4 次仍放行，第 5 次起锁定', async () => {
      const under = makeService(counters({ [`login:fail:admin:${USER}`]: 4 }));
      await expect(under.assertNotLocked(USER, IP)).resolves.toBeUndefined();

      const at = makeService(counters({ [`login:fail:admin:${USER}`]: 5 }));
      await expect(at.assertNotLocked(USER, IP)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('账号未超限但同 IP 撞库达 20 次也拒绝', async () => {
      const svc = makeService(counters({ [`login:fail:ip:${IP}`]: 20 }));
      await expect(svc.assertNotLocked(USER, IP)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('锁定提示与口令错误完全一致，不能成为口令预言机', async () => {
      const svc = makeService(counters({ [`login:fail:admin:${USER}`]: 9 }));
      // 与 AdminAuthService 中口令错误抛出的文案逐字相同
      await expect(svc.assertNotLocked(USER, IP)).rejects.toThrow(
        '用户名或密码错误',
      );
    });
  });

  describe('计数读写', () => {
    it('recordFailure 按账号与 IP 双键各记一次并续期', async () => {
      const redis = counters({});
      await makeService(redis).recordFailure(USER, IP);

      expect(redis.incr).toHaveBeenCalledWith(`login:fail:admin:${USER}`);
      expect(redis.incr).toHaveBeenCalledWith(`login:fail:ip:${IP}`);
      expect(redis.expire).toHaveBeenCalledTimes(2);
    });

    it('登录成功清零账号计数，但保留 IP 计数', async () => {
      const redis = counters({});
      await makeService(redis).clearFailures(USER);

      expect(redis.del).toHaveBeenCalledWith(`login:fail:admin:${USER}`);
      expect(redis.del).not.toHaveBeenCalledWith(`login:fail:ip:${IP}`);
    });
  });

  describe('Redis 故障时的方向', () => {
    it('读计数失败必须拒绝登录，而不是放行', async () => {
      const svc = makeService({
        get: jest.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
      });
      // 放行等于给攻击者一条「先打挂 Redis 再爆破」的路径，
      // 这与 PromoService 读失败按 0 处理的方向刻意相反。
      await expect(svc.assertNotLocked(USER, IP)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('写计数失败只记日志，不影响本次登录判定', async () => {
      const svc = makeService({
        incr: jest.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
        expire: jest.fn(() => Promise.resolve(1)),
      });
      await expect(svc.recordFailure(USER, IP)).resolves.toBeUndefined();
    });
  });
});
