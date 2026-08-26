import { BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { ClockService } from '../common/clock/clock.service';
import { GameConfigService } from '../config/game-config.service';
import { AdTokenService } from './ad-token.service';
import { BOOST_CONFIG } from './boost.config';

/** 桩只声明各用例真正用到的 Redis 命令：签发与核销都走 eval（原子 Lua）。 */
type RedisStub = Partial<
  Record<'get' | 'set' | 'incr' | 'expire' | 'eval', jest.Mock>
>;

describe('AdTokenService', () => {
  const clock: ClockService = {
    now: () => new Date('2026-01-01T04:00:00Z'),
    nowMs: () => 0,
  };

  /** 断言基准取代码内置默认值，与线上未改配置时的行为一致。 */
  const AD_TOKEN = BOOST_CONFIG['boost.ad_token'].default;
  const config = {
    get: () => Promise.resolve(AD_TOKEN),
  } as unknown as GameConfigService;

  function makeService(redis: RedisStub): AdTokenService {
    return new AdTokenService(clock, config, redis as unknown as Redis);
  }

  /**
   * 未达上限的签发环境：签发走一次 eval（原子 Lua），返回自增后的计数。
   * @param n 该次 eval 返回的计数（默认 1，即当天首枚）。
   */
  function issueRedis(n = 1): RedisStub {
    return { eval: jest.fn(() => Promise.resolve(n)) };
  }

  describe('issue 签发', () => {
    it('返回一次性 nonce，并用一次 eval 原子写 cap+nonce', async () => {
      const redis = issueRedis();
      const svc = makeService(redis);

      const res = await svc.issue('u1', 'race_double');

      expect(res.scene).toBe('race_double');
      expect(res.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(res.expiresInSec).toBe(AD_TOKEN.ttlSec);
      expect(res.remaining).toBe(AD_TOKEN.dailyCapPerScene - 1);

      // eval(script, numKeys=2, capKey, nonceKey, cap, scene, nonceTtl, capTtl)
      const call = redis.eval!.mock.calls[0] as unknown[];
      expect(call[0]).toEqual(expect.stringContaining("redis.call('INCR'"));
      expect(call[1]).toBe(2);
      expect(call[2]).toBe('adtoken:cap:u1:20260101:race_double');
      expect(call[3]).toBe(`adtoken:u1:${res.nonce}`);
      expect(call[4]).toBe(String(AD_TOKEN.dailyCapPerScene));
      expect(call[5]).toBe('race_double');
      expect(call[6]).toBe(String(AD_TOKEN.ttlSec));
    });

    it('每次签发的 nonce 不重复', async () => {
      const svc = makeService(issueRedis());

      const a = await svc.issue('u1', 'race_double');
      const b = await svc.issue('u1', 'race_double');
      expect(a.nonce).not.toBe(b.nonce);
    });

    it('达每日上限（Lua 返回 -1）：拒绝签发', async () => {
      const redis: RedisStub = { eval: jest.fn(() => Promise.resolve(-1)) };
      const svc = makeService(redis);

      await expect(svc.issue('u1', 'race_double')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('remaining 按 Lua 返回的计数递减（第 3 枚 → 剩 cap-3）', async () => {
      const svc = makeService(issueRedis(3));

      const res = await svc.issue('u1', 'race_double');
      expect(res.remaining).toBe(AD_TOKEN.dailyCapPerScene - 3);
    });

    it('凭证按 userId 隔离（nonceKey 带 userId）', async () => {
      const redis = issueRedis();
      const svc = makeService(redis);

      const res = await svc.issue('u2', 'race_revive');
      const call = redis.eval!.mock.calls[0] as unknown[];
      expect(call[3]).toBe(`adtoken:u2:${res.nonce}`);
    });

    it('每日计数按业务日分桶，capKey TTL 落在次日业务日切之内', async () => {
      const redis = issueRedis();
      const svc = makeService(redis);

      await svc.issue('u1', 'race_double');

      // 2026-01-01T04:00:00Z = 北京时间 12:00，业务日 20260101
      const call = redis.eval!.mock.calls[0] as unknown[];
      expect(call[2]).toBe('adtoken:cap:u1:20260101:race_double');
      const capTtl = Number(call[7]);
      expect(capTtl).toBeGreaterThan(0);
      expect(capTtl).toBeLessThanOrEqual(86400);
    });

    it('上限值随配置传入 Lua（运营改小后由 Lua 按新值判定）', async () => {
      const tightConfig = {
        get: () => Promise.resolve({ ...AD_TOKEN, dailyCapPerScene: 1 }),
      } as unknown as GameConfigService;
      // Lua 内 used(1) >= cap(1) → 返回 -1；这里桩直接给 -1 验拒绝路径
      const redis: RedisStub = { eval: jest.fn(() => Promise.resolve(-1)) };
      const svc = new AdTokenService(
        clock,
        tightConfig,
        redis as unknown as Redis,
      );

      await expect(svc.issue('u1', 'race_double')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      const call = redis.eval!.mock.calls[0] as unknown[];
      expect(call[4]).toBe('1');
    });
  });

  describe('consume 核销', () => {
    it('有效凭证：核销通过（走 Lua 原子读校删）', async () => {
      const redis: RedisStub = { eval: jest.fn(() => Promise.resolve(1)) };
      const svc = makeService(redis);

      await expect(
        svc.consume('u1', 'abc', 'race_double'),
      ).resolves.toBeUndefined();

      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('DEL'"),
        1,
        'adtoken:u1:abc',
        'race_double',
      );
    });

    it('不存在/已过期/已用掉：400 无效', async () => {
      const svc = makeService({ eval: jest.fn(() => Promise.resolve(0)) });

      await expect(svc.consume('u1', 'abc', 'race_double')).rejects.toThrow(
        '广告凭证无效或已过期',
      );
    });

    it('scene 不匹配：400 且提示场景不符', async () => {
      const svc = makeService({ eval: jest.fn(() => Promise.resolve(-1)) });

      await expect(svc.consume('u1', 'abc', 'race_revive')).rejects.toThrow(
        '广告凭证与当前场景不匹配',
      );
    });
  });
});
