import {
  defineConfig,
  posInt,
  strictObject,
} from '../config/game-config.types';
import type { ShapeOf } from '../config/game-config.types';

/** 兑换码防爆破参数。 */
export interface PromoGuard {
  /** 每人每日允许的**失败**次数，超过后当日拒绝受理 */
  dailyFailLimit: number;
  /** 每人每日允许的成功核销次数（防止一次性把整批码刷完） */
  dailySuccessLimit: number;
}

const DEFAULT_GUARD: PromoGuard = {
  dailyFailLimit: 10,
  dailySuccessLimit: 5,
};

export const PROMO_CONFIG = {
  'promo.guard': defineConfig<PromoGuard>({
    description:
      '兑换码防爆破：每人每日失败次数上限与成功核销次数上限（次日 0 点重置）',
    default: DEFAULT_GUARD,
    schema: strictObject({
      dailyFailLimit: posInt.max(1000).required(),
      dailySuccessLimit: posInt.max(1000).required(),
    }),
  }),
};

export type PromoConfigShape = ShapeOf<typeof PROMO_CONFIG>;

// ------------------------------------------------------------------ 纯函数

/**
 * 生码字符集：去掉 `0/O/1/I/L/U` 等易混字符。
 *
 * 线下场景里码是**印在物料上给人手抄**的，抄错一位就变成一次失败尝试，
 * 而失败是有每日上限的——字符集的可读性直接决定客服工单量。
 * 去掉 U 是为了避免生成出冒犯性单词。
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 玩家输入归一化：转大写并去掉所有非字符集字符。
 *
 * 玩家会带着空格、连字符、全角字符来提交（`abcd-efgh`、`ABCD EFGH`），
 * 这些都该命中同一个码，所以入库与查询都走这里。
 */
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => ALPHABET.includes(c))
    .join('');
}

/**
 * 生成一个码。`randomInt` 可注入以便测试。
 *
 * 用 `crypto.randomInt` 而非 `Math.random`：码本身就是凭证，
 * 可预测的伪随机数意味着能批量猜出未发放的码。
 */
export function generateCode(
  length: number,
  randomInt: (maxExclusive: number) => number,
): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
