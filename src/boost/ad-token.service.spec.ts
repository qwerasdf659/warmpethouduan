import { BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { ClockService } from '../common/clock/clock.service';
import { GameConfigService } from '../config/game-config.service';
import { AdTokenService } from './ad-token.service';
import { BOOST_CONFIG } from './boost.config';

/** 桩只声明各用例真正用到的 Redis 命令：签发走 get/set/incr/expire，核销走 eval。 */
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

  /** 未达每日上限、写入均成功的签发环境。 */
  function issueRedis(): RedisStub {
    return {
      get: jest.fn(() => Promise.resolve(null)),
      set: jest.fn(() => Promise.resolve('OK')),
      incr: jest.fn(() => Promise.resolve(1)),
      expire: jest.fn(() => Promise.resolve(1)),
    };
  }

  describe('issue 签发', () => {
    it('返回一次性 nonce 并按 TTL 落 Redis', async () => {
      const redis = issueRedis();
      const svc = makeService(redis);

      const res = await svc.issue('u1', 'race_double');

      expect(res.scene).toBe('race_double');
      expect(res.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(res.expiresInSec).toBe(AD_TOKEN.ttlSec);
      expect(res.remaining).toBe(AD_TOKEN.dailyCapPerScene - 1);
      expect(redis.set).toHaveBeenCalledWith(
        `adtoken:u1:${res.nonce}`,
        'race_double',
        'EX',
        AD_TOKEN.ttlSec,
      );
    });

    it('每次签发的 nonce 不重复', async () => {
      const svc = makeService(issueRedis());

      const a = await svc.issue('u1', 'race_double');
      const b = await svc.issue('u1', 'race_double');
      expect(a.nonce).not.toBe(b.nonce);
    });

    it('达每日上限：拒绝签发且不写 Redis', async () => {
      const redis: RedisStub = {
        get: jest.fn(() => Promise.resolve(String(AD_TOKEN.dailyCapPerScene))),
        set: jest.fn(),
        incr: jest.fn(),
        expire: jest.fn(),
      };
      const svc = makeService(redis);

      await expect(svc.issue('u1', 'race_double')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('凭证按 userId 隔离（key 带 userId）', async () => {
      const redis = issueRedis();
      const svc = makeService(redis);

      const res = await svc.issue('u2', 'race_revive');
      expect(redis.set).toHaveBeenCalledWith(
        `adtoken:u2:${res.nonce}`,
        'race_revive',
        'EX',
        AD_TOKEN.ttlSec,
      );
    });

    it('每日计数按业务日分桶，并设到次日业务日重置', async () => {
      const redis = issueRedis();
      const svc = makeService(redis);

      await svc.issue('u1', 'race_double');

      // 2026-01-01T04:00:00Z = 北京时间 12:00，业务日 20260101
      const capKey = 'adtoken:cap:u1:20260101:race_double';
      expect(redis.incr).toHaveBeenCalledWith(capKey);
      const [key, ttl] = redis.expire!.mock.calls[0] as [string, number];
      expect(key).toBe(capKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400);
    });

    it('上限被运营改小后立即按新值拒绝', async () => {
      const tightConfig = {
        get: () => Promise.resolve({ ...AD_TOKEN, dailyCapPerScene: 1 }),
      } as unknown as GameConfigService;
      const redis: RedisStub = {
        get: jest.fn(() => Promise.resolve('1')),
        set: jest.fn(),
        incr: jest.fn(),
        expire: jest.fn(),
      };
      const svc = new AdTokenService(
        clock,
        tightConfig,
        redis as unknown as Redis,
      );

      await expect(svc.issue('u1', 'race_double')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(redis.set).not.toHaveBeenCalled();
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
