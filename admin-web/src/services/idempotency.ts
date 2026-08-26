import { request } from '@umijs/max';
import type { IdempotencyRecord } from '@/types';

/**
 * 幂等记录查询（只读，需 player:read）。
 * 带 bizId 查单条（无记录返回 null），不带则扫该玩家全部（上限 500 条）。
 */
export async function queryIdempotency(params: {
  userId: string;
  bizId?: string;
}): Promise<IdempotencyRecord | IdempotencyRecord[] | null> {
  return request('/admin/idempotency', { method: 'GET', params });
}
