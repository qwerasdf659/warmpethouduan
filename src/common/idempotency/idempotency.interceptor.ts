import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import Redis from 'ioredis';
import { Observable, from, of, switchMap } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthUser } from '../../auth/jwt-auth.guard';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { IDEMPOTENT_KEY } from './idempotent.decorator';

const PENDING = '__PENDING__';
const PENDING_TTL_MS = 30_000; // 处理中占位，防并发重复
const RESULT_TTL_SEC = 24 * 60 * 60; // 结果缓存 24h，供重复提交回放

/**
 * 幂等拦截器（Redis 版）：
 *  1. 用 SET NX PX 抢占 idem:{userId}:{bizId} 占位；抢到 → 执行业务，成功后把结果写回该 key。
 *  2. 抢不到 → 若占位仍是 PENDING，说明上次仍在处理中，返回 409；否则回放上次结果。
 * 说明：M1 用 Redis 落地；经济域（M2）叠加 DB 唯一索引做持久化强去重。
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isIdempotent) return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const userId = req.user?.userId ?? 'anon';
    const bizId = (req.body as { bizId?: unknown } | undefined)?.bizId;
    if (!bizId || typeof bizId !== 'string') {
      throw new BadRequestException('缺少幂等参数 bizId');
    }

    const key = `idem:${userId}:${bizId}`;

    return from(this.redis.set(key, PENDING, 'PX', PENDING_TTL_MS, 'NX')).pipe(
      switchMap((acquired) => {
        if (acquired === 'OK') {
          return next.handle().pipe(
            tap({
              next: (result) => {
                void this.redis.set(
                  key,
                  JSON.stringify(result),
                  'EX',
                  RESULT_TTL_SEC,
                );
              },
              error: () => {
                // 失败则清占位，允许客户端重试
                void this.redis.del(key);
              },
            }),
          );
        }

        return from(this.redis.get(key)).pipe(
          switchMap((stored) => {
            if (!stored || stored === PENDING) {
              throw new ConflictException('请求处理中，请勿重复提交');
            }
            return of(JSON.parse(stored) as unknown);
          }),
        );
      }),
    );
  }
}
