/** 占位值：key 存在但业务尚未返回结果。 */
export const IDEMPOTENCY_PENDING = '__PENDING__';

/** 后台身份在幂等 key 里的命名空间段。玩家 id 是 bigint，不可能与之相撞。 */
export const IDEMPOTENCY_ADMIN_SCOPE = 'admin';

/** 玩家：`idem:{userId}:{bizId}`。 */
export function playerIdempotencyKey(userId: string, bizId: string): string {
  return `idem:${userId}:${bizId}`;
}

/**
 * 后台：`idem:admin:{adminUserId}:{bizId}`。
 *
 * 后台必须独立命名空间。此前后台走的是玩家拦截器、而后台身份挂在 `req.admin`
 * 不是 `req.user`，于是所有后台幂等 key 都退化成同一个 `idem:anon:{bizId}`——
 * 两个管理员用同一个 bizId 做不同操作会互相回放对方的结果。
 */
export function adminIdempotencyKey(
  adminUserId: string,
  bizId: string,
): string {
  return `idem:${IDEMPOTENCY_ADMIN_SCOPE}:${adminUserId}:${bizId}`;
}
