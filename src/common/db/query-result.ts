/**
 * 归一化 TypeORM `query()` 的返回形状。
 *
 * TypeORM 在这里**并不一致**（已在本库 PostgreSQL 16 上逐条实测）：
 *
 * | 语句 | 返回 |
 * | --- | --- |
 * | `SELECT` | `rows[]` |
 * | `INSERT ... RETURNING`（命中/未命中） | `rows[]` / `[]` |
 * | `UPDATE ... RETURNING`（命中/未命中） | `[rows[], 1]` / `[[], 0]` |
 * | `DELETE ... RETURNING`（命中/未命中） | `[rows[], 1]` / `[[], 0]` |
 *
 * 危险之处在于**未命中的 UPDATE 返回的是长度为 2 的数组**，于是
 * `res.length === 0` 恒为假、`res[0]` 取到的是内层的空数组而不是一行数据。
 * 「条件更新 + 检查影响行数」是本仓库表达原子占用的标准手法（余额扣减、
 * 兑换码领用、库存扣减都靠它），一旦这个判断失效，占用就完全不设防。
 *
 * 已经踩过三次：
 *  - `EconomyService` 余额读成 `NaN`；
 *  - `PromoService.claim` 的 `max_uses` 判断变成死代码，兑换码可被无限核销；
 *  - `ItemsService.consumeOwned` 库存不足时返回 `NaN` 而非 `null`，调用方判空放行。
 *
 * 所以**所有裸 SQL 的返回值都必须经过这里**，不要在调用点直接取下标。
 */
export function rowsOf<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length === 2 && Array.isArray(raw[0]) && typeof raw[1] === 'number') {
    return raw[0] as T[];
  }
  return raw as T[];
}
