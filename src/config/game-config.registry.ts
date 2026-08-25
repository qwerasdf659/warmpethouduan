import { BOOST_CONFIG } from '../boost/boost.config';
import { DAILY_CONFIG } from '../daily/daily.config';
import { DEX_CONFIG } from '../dex/dex.config';
import { EXCHANGE_CONFIG } from '../exchange/exchange.config';
import { PET_CONFIG } from '../pet/pet.config';
import { RACE_CONFIG } from '../race/race.config';
import type { ConfigEntry, ShapeOf } from './game-config.types';

/**
 * 全部可调配置项的总注册表。
 *
 * 配置项声明在**各自的域**里（`src/<域>/<域>.config.ts`），这里只做汇总：
 * 新增一个可调值只需改动对应域的文件，不必碰这里，也不会让本文件变成
 * 谁都要改的热点。
 */
export const CONFIG_REGISTRY = {
  ...PET_CONFIG,
  ...RACE_CONFIG,
  ...DAILY_CONFIG,
  ...BOOST_CONFIG,
  ...DEX_CONFIG,
  ...EXCHANGE_CONFIG,
};

/** key → 值类型 的映射，供 `GameConfigService` 提供类型安全的取值。 */
export type ConfigShape = ShapeOf<typeof CONFIG_REGISTRY>;

export type ConfigKey = keyof ConfigShape;

export const CONFIG_KEYS = Object.keys(CONFIG_REGISTRY) as ConfigKey[];

/** 运行期按 key 取声明（后台写入校验、种子灌入都要用）。 */
export function configEntryOf(key: string): ConfigEntry<unknown> | undefined {
  return (CONFIG_REGISTRY as Record<string, ConfigEntry<unknown>>)[key];
}
