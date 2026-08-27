import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENCY_PENDING } from './idempotency.keys';

/**
 * 幂等拦截器是**所有写接口的公共闸**，但它长期零单测覆盖 ——
 * 「后台身份挂在 req.admin 而这里读 req.user」这个把全部后台幂等键塌成
 * `idem:anon:{bizId}` 的缺陷，正是因此一直没有被发现。
 *
 * 本文件按身份作用域与并发分支逐条固定行为，尤其是 key 的**实际拼法**：
 * 断言 key 字符串而不只是断言「调用了 redis.set」，否则命名空间改错照样绿。
 */
describe('IdempotencyInterceptor', () => {
  interface FakeRedis {
    set: jest.Mock;
    get: jest.Mock;
    del: jest.Mock;
  }

  let redis: FakeRedis;

  const makeContext = (req: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  const makeInterceptor = (isIdempotent = true) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(isIdempotent),
    } as unknown as Reflector;
    return new IdempotencyInterceptor(redis as unknown as Redis, reflector);
  };

  const handlerOf = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  beforeEach(() => {
    redis = {
      // 默认抢占成功
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
    };
  });

  describe('作用域与 key 拼法', () => {
    it('玩家身份 → idem:{userId}:{bizId}', async () => {
      const ctx = makeContext({
        user: { userId: '42' },
        body: { bizId: 'b1' },
      });
      await firstValueFrom(
        makeInterceptor().intercept(ctx, handlerOf({ ok: true })),
      );

      expect(redis.set).toHaveBeenCalledWith(
        'idem:42:b1',
        IDEMPOTENCY_PENDING,
        'PX',
        expect.any(Number),
        'NX',
      );
    });

    it('后台身份 → idem:admin:{adminUserId}:{bizId}（不再塌成 anon）', async () => {
      const ctx = makeContext({
        admin: { adminUserId: '7', username: 'ops' },
        body: { bizId: 'b1' },
      });
      await firstValueFrom(
        makeInterceptor().intercept(ctx, handlerOf({ ok: true })),
      );

      expect(redis.set).toHaveBeenCalledWith(
        'idem:admin:7:b1',
        IDEMPOTENCY_PENDING,
        'PX',
        expect.any(Number),
        'NX',
      );
    });

    it('两个管理员用同一 bizId 不互相命中', async () => {
      const run = async (adminUserId: string) => {
        const ctx = makeContext({
          admin: { adminUserId },
          body: { bizId: 'same' },
        });
        await firstValueFrom(
          makeInterceptor().intercept(ctx, handlerOf({ ok: true })),
        );
      };
      await run('1');
      await run('2');

      const keys = (redis.set.mock.calls as unknown[][])
        .filter((c) => c[1] === IDEMPOTENCY_PENDING)
        .map((c) => String(c[0]));
      expect(new Set(keys).size).toBe(2);
    });

    it('无任何身份直接拒绝，而不是退化成共享作用域', () => {
      const ctx = makeContext({ body: { bizId: 'b1' } });
      expect(() =>
        makeInterceptor().intercept(ctx, handlerOf({ ok: true })),
      ).toThrow(UnauthorizedException);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('缺 bizId 判 400', () => {
      const ctx = makeContext({ user: { userId: '42' }, body: {} });
      expect(() =>
        makeInterceptor().intercept(ctx, handlerOf({ ok: true })),
      ).toThrow(BadRequestException);
    });

    it('既缺 bizId 又无身份时报 400 而非 401（参数错误先于鉴权失败）', () => {
      const ctx = makeContext({ body: {} });
      expect(() =>
        makeInterceptor().intercept(ctx, handlerOf({ ok: true })),
      ).toThrow(BadRequestException);
    });

    it('未标注 @Idempotent 的接口原样放行，不碰 Redis', async () => {
      const ctx = makeContext({ body: {} });
      const out = await firstValueFrom(
        makeInterceptor(false).intercept(ctx, handlerOf('passthrough')),
      );
      expect(out).toBe('passthrough');
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('并发与回放', () => {
    it('抢占成功：执行业务并把结果写回该 key', async () => {
      const ctx = makeContext({
        user: { userId: '42' },
        body: { bizId: 'b1' },
      });
      const out = await firstValueFrom(
        makeInterceptor().intercept(ctx, handlerOf({ n: 1 })),
      );

      expect(out).toEqual({ n: 1 });
      expect(redis.set).toHaveBeenCalledWith(
        'idem:42:b1',
        JSON.stringify({ n: 1 }),
        'EX',
        expect.any(Number),
      );
    });

    it('抢不到且占位仍是 PENDING：409，不重复执行业务', async () => {
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(IDEMPOTENCY_PENDING);
      const handle = jest.fn(() => of({ n: 1 }));

      const ctx = makeContext({
        user: { userId: '42' },
        body: { bizId: 'b1' },
      });
      await expect(
        firstValueFrom(makeInterceptor().intercept(ctx, { handle })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(handle).not.toHaveBeenCalled();
    });

    it('抢不到但已有结果：回放上次结果，不重复执行业务', async () => {
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(JSON.stringify({ n: 7 }));
      const handle = jest.fn(() => of({ n: 999 }));

      const ctx = makeContext({
        user: { userId: '42' },
        body: { bizId: 'b1' },
      });
      const out = await firstValueFrom(
        makeInterceptor().intercept(ctx, { handle }),
      );

      expect(out).toEqual({ n: 7 });
      expect(handle).not.toHaveBeenCalled();
    });

    it('业务抛错：清掉占位，允许客户端重试', async () => {
      const ctx = makeContext({
        user: { userId: '42' },
        body: { bizId: 'b1' },
      });
      const failing: CallHandler = {
        handle: () => throwError(() => new Error('boom')),
      };

      await expect(
        firstValueFrom(makeInterceptor().intercept(ctx, failing)),
      ).rejects.toThrow('boom');
      expect(redis.del).toHaveBeenCalledWith('idem:42:b1');
    });
  });
});
