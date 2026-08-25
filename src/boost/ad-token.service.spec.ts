import { BadRequestException } from '@nestjs/common';
import { AdTokenService } from './ad-token.service';
import { AD_TOKEN } from './boost.config';

describe('AdTokenService', () => {
  const clock = { now: () => new Date('2026-01-01T04:00:00Z'), nowMs: () => 0 };

  function makeService(redis: any): AdTokenService {
    return new AdTokenService(clock as any, redis as any);
  }

  describe('issue 签发', () => {
    it('返回一次性 nonce 并按 TTL 落 Redis', async () => {
      const redis = {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        incr: jest.fn(async () => 1),
        expire: jest.fn(async () => 1),
      };
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
      const redis = {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        incr: jest.fn(async () => 1),
        expire: jest.fn(async () => 1),
      };
      const svc = makeService(redis);

      const a = await svc.issue('u1', 'race_double');
      const b = await svc.issue('u1', 'race_double');
      expect(a.nonce).not.toBe(b.nonce);
    });

    it('达每日上限：拒绝签发且不写 Redis', async () => {
      const redis = {
        get: jest.fn(async () => String(AD_TOKEN.dailyCapPerScene)),
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
      const redis = {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        incr: jest.fn(async () => 1),
        expire: jest.fn(async () => 1),
      };
      const svc = makeService(redis);

      const res = await svc.issue('u2', 'race_revive');
      expect(redis.set).toHaveBeenCalledWith(
        `adtoken:u2:${res.nonce}`,
        'race_revive',
        'EX',
        AD_TOKEN.ttlSec,
      );
    });
  });

  describe('consume 核销', () => {
    it('有效凭证：核销通过（走 Lua 原子读校删）', async () => {
      const redis = { eval: jest.fn(async () => 1) };
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
      const redis = { eval: jest.fn(async () => 0) };
      const svc = makeService(redis);

      await expect(
        svc.consume('u1', 'abc', 'race_double'),
      ).rejects.toThrow('广告凭证无效或已过期');
    });

    it('scene 不匹配：400 且提示场景不符', async () => {
      const redis = { eval: jest.fn(async () => -1) };
      const svc = makeService(redis);

      await expect(
        svc.consume('u1', 'abc', 'race_revive'),
      ).rejects.toThrow('广告凭证与当前场景不匹配');
    });
  });
});
