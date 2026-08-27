import { BOOST_CONFIG } from '../boost/boost.config';
import { BREED_CONFIG } from '../breed/breed.config';
import { CLINIC_CONFIG } from '../clinic/clinic.config';
import { DAILY_CONFIG } from '../daily/daily.config';
import { DEX_CONFIG } from '../dex/dex.config';
import { EXCHANGE_CONFIG } from '../exchange/exchange.config';
import { FUSION_CONFIG } from '../fusion/fusion.config';
import { GACHA_CONFIG } from '../gacha/gacha.config';
import { HOME_CONFIG } from '../home/home.config';
import { ITEMS_CONFIG } from '../items/items.config';
import { MARKET_CONFIG } from '../market/market.config';
import { MINIGAME_CONFIG } from '../minigame/minigame.config';
import { PET_CONFIG } from '../pet/pet.config';
import { PROMO_CONFIG } from '../promo/promo.config';
import { PVP_CONFIG } from '../pvp/pvp.config';
import { RACE_CONFIG } from '../race/race.config';
import { TRADE_CONFIG } from '../trade/trade.config';
import { TRAINING_CONFIG } from '../training/training.config';
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
  ...GACHA_CONFIG,
  ...HOME_CONFIG,
  ...ITEMS_CONFIG,
  ...MARKET_CONFIG,
  ...PROMO_CONFIG,
  // ---- 玩法扩展新建域（P1/P3/P4/P7/P8/P11/P13 + 双向易货）
  ...BREED_CONFIG,
  ...PVP_CONFIG,
  ...CLINIC_CONFIG,
  ...FUSION_CONFIG,
  ...MINIGAME_CONFIG,
  ...TRAINING_CONFIG,
  ...TRADE_CONFIG,
};

/** key → 值类型 的映射，供 `GameConfigService` 提供类型安全的取值。 */
export type ConfigShape = ShapeOf<typeof CONFIG_REGISTRY>;

export type ConfigKey = keyof ConfigShape;

export const CONFIG_KEYS = Object.keys(CONFIG_REGISTRY) as ConfigKey[];

/** 运行期按 key 取声明（后台写入校验、种子灌入都要用）。 */
export function configEntryOf(key: string): ConfigEntry<unknown> | undefined {
  return (CONFIG_REGISTRY as Record<string, ConfigEntry<unknown>>)[key];
}
