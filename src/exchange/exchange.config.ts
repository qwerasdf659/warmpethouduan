/**
 * 兑换中心目录（配置）。实物用营销积分（marketing）兑换、可发货；
 * 虚拟奖励即时到账。后续可迁 DB 的 exchange_def 表由运营 CRUD。
 */
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

export const EXCHANGE_ITEMS: ExchangeItem[] = [
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

export function getExchangeItem(key: string): ExchangeItem | undefined {
  return EXCHANGE_ITEMS.find((e) => e.key === key);
}
