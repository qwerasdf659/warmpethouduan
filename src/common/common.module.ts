import { Global, Module } from '@nestjs/common';
import { ClockService } from './clock/clock.service';
import { LockService } from './lock/lock.service';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { CspReportService } from './security/csp-report.service';

/**
 * 基础设施（全局）：服务端时钟、玩家级分布式锁、幂等拦截器、CSP 违规收集器。
 * 前三者依赖 RedisModule 导出的 REDIS_CLIENT（已全局）；CSP 收集器只依赖时钟。
 */
@Global()
@Module({
  providers: [
    ClockService,
    LockService,
    IdempotencyInterceptor,
    CspReportService,
  ],
  exports: [
    ClockService,
    LockService,
    IdempotencyInterceptor,
    CspReportService,
  ],
})
export class CommonModule {}
