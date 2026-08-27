/**
 * 业务日切工具（固定东八区，无夏令时，用固定偏移即精确）。
 * 「业务日」= 东八区自然日，所有每日额度/签到/任务的日切基准统一走这里，
 * 避免各模块各写一份导致口径漂移。
 */

export const BUSINESS_TZ_OFFSET_MS = 8 * 3_600_000;

/**
 * 业务时区的 IANA 名。`@Cron({ timeZone })` 与 SQL 的 `AT TIME ZONE` 都引用它。
 *
 * 与 `BUSINESS_TZ_OFFSET_MS` 是同一件事的两种表达：JS 侧算日切用固定偏移（无夏令时，
 * 固定偏移即精确且不依赖运行环境的 tz 数据库），而 cron 调度器与 Postgres 只认时区名。
 * 两者必须同源，否则「日报按东八区切、cron 却按 UTC 触发」这类错位极难被发现。
 */
export const BUSINESS_TZ = 'Asia/Shanghai';

/** 业务日键（东八区），形如 20260825。 */
export function businessDayKey(now: Date): string {
  const shifted = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = `${shifted.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${shifted.getUTCDate()}`.padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 业务日期串（东八区），形如 2026-08-25。
 *
 * 与 `businessDayKey` 的区别只是分隔符，但用途不同：本函数喂给 `date` 类型的列
 * （如 `trade_risk_daily.stat_day`），Postgres 只认带横线的形态。
 */
export function businessDateString(now: Date): string {
  const k = businessDayKey(now);
  return `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
}

/** 距下一个东八区 00:00 的秒数（用作每日计数键的 TTL）。 */
export function secondsUntilNextBusinessDay(now: Date): number {
  const shifted = now.getTime() + BUSINESS_TZ_OFFSET_MS;
  const dayMs = 86_400_000;
  return Math.ceil((dayMs - (shifted % dayMs)) / 1000);
}

/** 某业务日 00:00（东八区）对应的绝对时刻（UTC Date）。 */
export function startOfBusinessDay(now: Date): Date {
  const key = businessDayKey(now);
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(4, 6));
  const d = Number(key.slice(6, 8));
  // 该日 00:00(CST) = 该日 00:00(UTC) − 8h
  return new Date(Date.UTC(y, m - 1, d) - BUSINESS_TZ_OFFSET_MS);
}

/** 判断两个业务日键是否为连续的两天（用于签到连签判定）。 */
export function isConsecutiveDay(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  const p = parseDayKey(prev);
  const n = parseDayKey(next);
  if (!p || !n) return false;
  const diff = (n.getTime() - p.getTime()) / 86_400_000;
  return Math.round(diff) === 1;
}

function parseDayKey(key: string): Date | null {
  if (!/^\d{8}$/.test(key)) return null;
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(4, 6));
  const d = Number(key.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d));
}
