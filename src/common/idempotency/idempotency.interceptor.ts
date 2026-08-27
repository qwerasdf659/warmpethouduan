import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import Redis from 'ioredis';
import { Observable, from, of, switchMap } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { AdminPrincipal } from '../../admin/admin-principal';
import { AuthUser } from '../../auth/jwt-auth.guard';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { IDEMPOTENT_KEY } from './idempotent.decorator';
import {
  IDEMPOTENCY_PENDING as PENDING,
  adminIdempotencyKey,
  playerIdempotencyKey,
} from './idempotency.keys';

const PENDING_TTL_MS = 30_000; // 处理中占位，防并发重复
const RESULT_TTL_SEC = 24 * 60 * 60; // 结果缓存 24h，供重复提交回放

/**
 * 幂等拦截器（Redis 版）：
 *  1. 用 SET NX PX 抢占幂等 key 占位；抢到 → 执行业务，成功后把结果写回该 key。
 *  2. 抢不到 → 若占位仍是 PENDING，说明上次仍在处理中，返回 409；否则回放上次结果。
 *
 * key 按身份分命名空间（见 `idempotency.keys.ts`）：玩家端与后台各自独立。
 * 两端共用一个拦截器是有意的——幂等语义完全相同，分两份实现只会漂移。
 *
 * 幂等只保证「同一身份 + 同一 bizId 不重复执行」，**不缓存任何余额或库存**。
 * 缓存余额会让 Redis 成为账实不符的源头，余额的唯一权威是 `asset_balance`。
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
      .getRequest<Request & { user?: AuthUser; admin?: AdminPrincipal }>();
    const bizId = (req.body as { bizId?: unknown } | undefined)?.bizId;
    if (!bizId || typeof bizId !== 'string') {
      throw new BadRequestException('缺少幂等参数 bizId');
    }

    // 没有身份就没有幂等作用域。以前这里回退到字面量 'anon'，把所有后台请求
    // 挤进同一个 key —— 与其静默地把幂等降级成全局互斥，不如直接拒绝
    let key: string;
    if (req.user) {
      key = playerIdempotencyKey(req.user.userId, bizId);
    } else if (req.admin) {
      key = adminIdempotencyKey(req.admin.adminUserId, bizId);
    } else {
      throw new UnauthorizedException('幂等请求需要已认证身份');
    }

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
