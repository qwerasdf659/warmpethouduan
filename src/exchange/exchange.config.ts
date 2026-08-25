/**
 * 兑换中心目录。实物用营销积分（marketing）兑换、可发货；虚拟奖励即时到账。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';

export interface ExchangeItem {
  key: string;
  name: string;
  type: 'physical' | 'virtual';
  /** 兑换花费 */
  cost: number;
  /** 计费积分池：实物一般用 marketing */
  pool: 'game' | 'marketing';
  desc: string;
  sortOrder: number;
}

const DEFAULT_ITEMS: ExchangeItem[] = [
  {
    key: 'coupon_5',
    name: '5 元代金券',
    type: 'virtual',
    cost: 500,
    pool: 'marketing',
    desc: '到账后可在合作门店核销',
    sortOrder: 1,
  },
  {
    key: 'plush_toy',
    name: '宠物同款玩偶',
    type: 'physical',
    cost: 2000,
    pool: 'marketing',
    desc: '实物包邮，7 个工作日内发货',
    sortOrder: 2,
  },
  {
    key: 'mug',
    name: '定制马克杯',
    type: 'physical',
    cost: 1200,
    pool: 'marketing',
    desc: '实物包邮',
    sortOrder: 3,
  },
];

export const EXCHANGE_CONFIG = {
  'exchange.items': defineConfig<ExchangeItem[]>({
    description: '兑换目录：physical 需收货地址并走发货流程，virtual 即时到账',
    default: DEFAULT_ITEMS,
    schema: Joi.array()
      .items(
        strictObject({
          key: Joi.string().max(48).required(),
          name: Joi.string().max(64).required(),
          type: Joi.string().valid('physical', 'virtual').required(),
          // 允许 0 成本（做活动白送），但不允许负数
          cost: nonNegInt.required(),
          pool: Joi.string().valid('game', 'marketing').required(),
          desc: Joi.string().max(128).allow('').required(),
          sortOrder: nonNegInt.required(),
        }),
      )
      // 允许空数组：运营可临时下架整个兑换中心
      .required(),
  }),
};

export type ExchangeConfigShape = ShapeOf<typeof EXCHANGE_CONFIG>;

export function getExchangeItem(
  items: ExchangeItem[],
  key: string,
): ExchangeItem | undefined {
  return items.find((e) => e.key === key);
}
