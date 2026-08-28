/**
 * 兑换中心目录。实物用营销积分兑换、可发货；虚拟奖励即时到账。
 */
import * as Joi from 'joi';
import {
  defineConfig,
  nonNegInt,
  strictObject,
  type ShapeOf,
} from '../config/game-config.types';
import { GAME_COIN, MARKETING_POINT } from '../ledger/ledger.types';

export interface ExchangeItem {
  key: string;
  name: string;
  type: 'physical' | 'virtual';
  /** 兑换花费 */
  cost: number;
  /** 计价货币资产 code：实物一般用 `marketing_point` */
  costAsset: string;
  desc: string;
  sortOrder: number;
  /**
   * 全站库存上限（件）。`null` = 不限量。
   *
   * 已兑数不另存计数器，而是从 `redeem_order` 里按 `status <> 'cancelled'` 实时数出来：
   * 单一事实来源、不会漂移，取消订单天然回库。
   */
  stock: number | null;
  /** 每人限兑件数。`null` = 不限。同样按非取消订单计数。 */
  perUserLimit: number | null;
  /**
   * 虚拟品的自动发放资产 code（`asset_def.code`）。`null` = 不自动发货。
   *
   * 只对 `type='virtual'` 生效：填了就在下单时直接进背包、订单落 `shipped`，
   * 真正做到「即时到账」；不填则和实物一样留 `pending` 等运营处理
   * （例如线下核销的代金券，后台确认后才 ship）。
   */
  grantItemKey: string | null;
  /** 自动发放的件数（`grantItemKey` 为 null 时忽略） */
  grantQty: number;
}

/**
 * 默认兑换目录。
 *
 * 刻意混编两种货币：营销积分兑实物/权益（合规框架见规格 §6.1），
 * **游戏币兑虚拟礼包**则让兑换中心对「从没参加过线下活动」的玩家也有内容 ——
 * 整份目录只收营销积分的话，而营销积分只有站外来源，等于玩家永远兑不动。
 */
const DEFAULT_ITEMS: ExchangeItem[] = [
  {
    key: 'coupon_off5',
    name: '满 50 减 5 券',
    type: 'virtual',
    cost: 500,
    costAsset: MARKETING_POINT,
    desc: '立刻到账，90 天内有效；到店出示核销码，单笔满 50 元减 5 元',
    sortOrder: 1,
    stock: null,
    perUserLimit: null,
    // 券即时进背包，不再是「等运营手工发货」的 pending 单：
    // 有效期由 asset_lot 批次过期管，核销走 POST /exchange/coupon/redeem
    grantItemKey: 'coupon_off5',
    grantQty: 1,
  },
  {
    key: 'plush_toy',
    name: '宠物同款玩偶',
    type: 'physical',
    cost: 2000,
    costAsset: MARKETING_POINT,
    desc: '实物包邮，7 个工作日内发货',
    sortOrder: 2,
    // 实物默认给保守库存与每人 1 件：备货是真金白银，宁可运营主动放开
    stock: 100,
    perUserLimit: 1,
    grantItemKey: null,
    grantQty: 0,
  },
  {
    key: 'mug',
    name: '定制马克杯',
    type: 'physical',
    cost: 1200,
    costAsset: MARKETING_POINT,
    desc: '实物包邮',
    sortOrder: 3,
    stock: 200,
    perUserLimit: 2,
    grantItemKey: null,
    grantQty: 0,
  },
  // ---- 游戏币档（自动到账，无需运营介入）----
  {
    key: 'snack_pack',
    name: '零食礼包 ×10',
    type: 'virtual',
    cost: 700,
    costAsset: GAME_COIN,
    desc: '立刻到账 10 份宠物零食',
    sortOrder: 10,
    stock: null,
    perUserLimit: null,
    grantItemKey: 'cons_snack',
    grantQty: 10,
  },
  {
    key: 'care_pack',
    name: '护理礼包 ×5',
    type: 'virtual',
    cost: 900,
    costAsset: GAME_COIN,
    desc: '立刻到账 5 份清洁泡泡与 5 份玩具球',
    sortOrder: 11,
    stock: null,
    perUserLimit: null,
    grantItemKey: 'cons_bubble',
    grantQty: 5,
  },
  {
    key: 'energy_pack',
    name: '能量礼包 ×5',
    type: 'virtual',
    cost: 1500,
    costAsset: GAME_COIN,
    desc: '立刻到账 5 份能量饮，赛跑前补体力',
    sortOrder: 12,
    stock: null,
    perUserLimit: null,
    grantItemKey: 'cons_energy',
    grantQty: 5,
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
          costAsset: Joi.string().valid(GAME_COIN, MARKETING_POINT).required(),
          desc: Joi.string().max(128).allow('').required(),
          sortOrder: nonNegInt.required(),
          // 必填但可为 null：强迫运营对每个兑换项显式表态「限量还是不限量」
          stock: nonNegInt.allow(null).required(),
          perUserLimit: Joi.number()
            .integer()
            .min(1)
            .allow(null)
            .required()
            .messages({
              'number.min': 'perUserLimit 至少为 1；要下架请把 stock 设为 0',
            }),
          // 必填但可为 null：和 stock 同理，逼运营对「是否自动发货」显式表态
          grantItemKey: Joi.string().max(48).allow(null).required(),
          // 填了物品键就必须给正数件数，否则「自动发货」会静默发 0 件
          grantQty: nonNegInt.required().when('grantItemKey', {
            is: Joi.string(),
            then: Joi.number().integer().min(1).max(999).required(),
          }),
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
