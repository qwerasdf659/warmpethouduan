import { Global, Module } from '@nestjs/common';
import { ClockService } from './clock/clock.service';
import { LockService } from './lock/lock.service';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';

/**
 * 基础设施三件套（全局）：服务端时钟、玩家级分布式锁、幂等拦截器。
 * 依赖 RedisModule 导出的 REDIS_CLIENT（已全局）。
 */
@Global()
@Module({
  providers: [ClockService, LockService, IdempotencyInterceptor],
  exports: [ClockService, LockService, IdempotencyInterceptor],
})
export class CommonModule {}
