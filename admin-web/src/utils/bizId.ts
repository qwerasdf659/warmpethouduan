/**
 * 生成本次写操作的幂等 bizId（浏览器原生 UUID）。
 *
 * 后端所有写接口都靠 bizId 去重，所以每次**用户动作**生成一个、重试时复用同一个，
 * 才能让"点了没反应又点一次"不变成两笔账。
 */
export function newBizId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
