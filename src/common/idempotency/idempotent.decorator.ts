import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * 标注需要幂等保护的写接口。入参必须携带全局唯一 bizId。
 * 配合 IdempotencyInterceptor：同一 (userId, bizId) 重复提交返回上次结果。
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
