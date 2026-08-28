import type { AssetKind, AssetMeta } from '../entities/asset-def.entity';
import { GAME_COIN, MARKETING_POINT } from './ledger.types';

export interface AssetSeed {
  code: string;
  kind: AssetKind;
  name: string;
  tradable: boolean;
  redeemable?: boolean;
  gachaOutput?: boolean;
  expireDays?: number | null;
  mintLimit?: number | null;
  tradeCooldownHours?: number;
  sortOrder: number;
  meta?: AssetMeta;
}

/**
 * `asset_def` 初始播种（幂等：按 code 只补新行，不改已存在行的价格与合规开关）。
 *
 * ⚠ **播种只补新 code**。因此调价或调整合规开关必须同时写迁移，否则老库仍是旧值
 * ——这是有意的：播种在每次启动时都跑，
 * 若它会覆盖现有行，运营在后台做的任何调整都会在下次重启时被静默还原。
 *
 * ------------------------------------------------------------------
 * 定价口径（沿用 2026-08-26 重标定，重构不改数值）：
 * 保守日收入约 900 游戏币（互动上限 500 + 签到 100 + 每日任务 85 + 离线 80 + 广告 150）。
 * 收藏品目录合计约 18700，即全买断约需三周。三周之后靠**可重复消耗**兜住产出：
 * 扭蛋、消耗品、赛跑门票、加速与体力恢复。
 *
 * ------------------------------------------------------------------
 * 合规开关的分配（架构设计 §3.3，三个开关两两互斥关系由 DB CHECK 兜底）：
 *
 *  - `game_coin`        可交易，不可兑实物，不再由扭蛋产出（D1）
 *  - `marketing_point`  可兑实物 ⇒ **禁止流转**，且必须有过期以给负债封顶（D10/D11）
 *  - 商店收藏品         可交易（这是交易市场的主要标的）
 *  - **扭蛋产出物**     `gachaOutput = true` ⇒ 必须 `tradable = false`
 *
 * 最后一条是硬约束而非偏好：可交易 + 随机产出 = 「投入→随机→可变现」，
 * 这是开箱模式，敏感度高于交易本身。`ck_asset_no_trade_gacha` 会在
 * 写入时直接拦住任何试图同时打开两个开关的配置。
 */
export const SEED_ASSETS: AssetSeed[] = [
  // ---------------------------------------------------------------- 货币
  {
    code: GAME_COIN,
    kind: 'currency',
    name: '游戏币',
    tradable: true,
    // 永不过期：符合玩家预期（辛苦攒的币不该凭空消失）。
    // 但批次模型已就位，真要开启只需把这里改成天数，不必改表结构（D2）。
    expireDays: null,
    sortOrder: 1,
    meta: { itemType: undefined },
  },
  {
    code: MARKETING_POINT,
    kind: 'currency',
    name: '营销积分',
    tradable: false,
    redeemable: true,
    /**
     * D11：365 天，按自然月末归并（见 `LedgerService.issueLot`）。
     *
     * 可兑实物 ⇒ 它是**财务负债**，负债必须封顶。不设过期意味着待兑付金额单调
     * 增长且永不释放，几年后运营面对的是一笔无法估算的敞口。归并后每玩家每月
     * 至多一行，365 天窗口下最多 13 行，FIFO 扫描代价可忽略。
     */
    expireDays: 365,
    sortOrder: 2,
  },

  // ---------------------------------------------------------------- 皮肤（unique，body 槽）
  skin('skin_default', '原色', 0, 1),
  skin('skin_snow', '雪白', 400, 2),
  skin('skin_tiger', '虎纹', 900, 3),
  skin('skin_calico', '三花', 1400, 4),
  // 扭蛋稀有产出 ⇒ 不可交易
  gachaLoot(skin('skin_shadow', '玄影', 2200, 5)),
  /**
   * 限量收藏品（D3）。`mintLimit` 一旦有人买到就**不可下调**，
   * 因为已发出的编号无法收回。
   *
   * 限量编号是交易市场的价值锚：「第 7/100 件」本身产生收藏溢价，而这只有在
   * 实例化之后才可能 —— 事后无法补，因为无法确定历史上谁先获得。
   */
  {
    ...skin('skin_aurora', '极光（限量）', 5000, 6),
    mintLimit: 100,
  },

  // ---------------------------------------------------------------- 配饰（unique）
  accessory('acc_cap', '棒球帽', 'hat', 300, 10),
  accessory('acc_bow', '蝴蝶结', 'hat', 450, 11),
  accessory('acc_glasses', '墨镜', 'hat', 700, 12),
  accessory('acc_crown', '小皇冠', 'hat', 1600, 13),
  accessory('acc_bell', '铃铛', 'neck', 350, 20),
  accessory('acc_bandana', '领巾', 'neck', 500, 21),
  accessory('acc_scarf', '围巾', 'neck', 600, 22),
  // 背景走 accessory：它是**穿在宠物身上的外观**，属于换装子系统
  accessory('bg_room', '暖阳小屋', 'bg', 0, 30),
  accessory('bg_garden', '午后花园', 'bg', 800, 31),
  gachaLoot(accessory('bg_beach', '海边夕照', 'bg', 1200, 32)),
  accessory('bg_starry', '星夜露台', 'bg', 1800, 33),

  // ---------------------------------------------------------------- 家具（stackable）
  // 占格尺寸按体积给，6×6 房间共 36 格，全套摆下约占 15 格
  furniture('furn_bowl', '食盆', 200, 5, 1, 1, 40),
  furniture('furn_mat', '暖垫', 250, 8, 2, 2, 41),
  furniture('furn_lamp', '落地灯', 550, 10, 1, 1, 42),
  furniture('furn_rug', '圆形地毯', 700, 12, 2, 2, 43),
  furniture('furn_sofa', '沙发', 900, 15, 2, 1, 44),
  furniture('furn_tree', '猫爬架', 1300, 20, 1, 2, 45),
  furniture('furn_window', '落地窗', 1600, 18, 1, 2, 46),

  // ---------------------------------------------------------------- 消耗品（stackable）
  // 效果在配置中心 `items.consumables`，此处只管目录与价格。
  // 单价刻意做低：它们是「日常小额、可无限重复」的 sink，靠频次而非单价吸币。
  consumable('cons_toy', '玩具球', 50, 60),
  // 出现在扭蛋奖池里的消耗品必须 tradable=false：否则「投入货币 → 随机 → 产出
  // 可自由转让的资产」这条链就通了。奖池配置与这里的开关必须同步改，
  // `gacha.config.spec.ts` 有一条断言专门守这个对应关系。
  gachaLoot(consumable('cons_snack', '宠物零食', 60, 61)),
  gachaLoot(consumable('cons_bubble', '清洁泡泡', 60, 62)),
  gachaLoot(consumable('cons_energy', '能量饮', 120, 63)),
  gachaLoot(consumable('cons_cake', '生日蛋糕', 300, 64)),
  // P1 治疗用药：可交易、非扭蛋产出。items.consumables 里刻意不配效果，
  // 于是它可买可囤但走 /items/consumables/use 会被拒，只能走 /pet/cure 消耗。
  consumable('cons_medicine', '宠物药品', 150, 65),

  // P2 Petpet（unique，槽位 pet）：全部可交易、非扭蛋产出，meta.bonus 走 PetBonusService。
  //
  // `pp_bug` 走商店而不是扭蛋稀有档，是两个理由叠加的结果（文档 §7.4）：
  //  1. 进扭蛋就必须 `gachaOutput=true + tradable=false`（ck_asset_no_trade_gacha），
  //     后台建不出来、只能靠迁移插行，凭空多一次迁移；
  //  2. 原稿给它的 `raceScore` 加成会直接改赛跑名次，而赛跑是异步 PvP 的底层，
  //     天梯会退化成装备战。改成 `expGain` 后，「影响赛跑」这个特权只留给训练技巧。
  petpet('pp_bird', '小鸟', 800, 70, { offlineRate: 0.05 }, 'uncommon'),
  petpet('pp_fish', '小鱼', 1200, 71, { expGain: 0.1 }, 'rare'),
  petpet('pp_bug', '瓢虫', 1000, 72, { expGain: 0.06 }, 'uncommon'),
  petpet('pp_ghost', '小幽灵', 1600, 73, { moodDecay: -0.1 }, 'rare'),

  // ---------------------------------------------------------------- 优惠券（stackable）
  //
  // 券是**满减券**而不是面值代金券，这是刻意的：带面值、可核销、可转让的凭证
  // 容易被认定为单用途商业预付凭证，牵出备案与资金存管要求。满减
  // （「满 50 减 5」）在定性上是折扣而不是储值。
  //
  // 三个开关的组合是这套设计的关键：
  //  - `redeemable: true` ⇒ 数据库 CHECK（ck_asset_no_trade_redeem）强制
  //    `tradable: false`，于是券天然不可赠送、不可挂单、不可回收，
  //    「积分 → 券 → 卖给别人换币」这条变现链在库层就断了；
  //  - `expireDays` ⇒ 直接接入现成的 `asset_lot` 批次过期与每日过期作业，
  //    有效期不需要任何新代码，同时给待兑付负债封了顶。
  discountCoupon('coupon_off5', '满 50 减 5 券', 5_000, 500, 90, 80),
];

// ------------------------------------------------------------------ 构造助手

/**
 * 标记为扭蛋产出物。
 *
 * 两个开关必须**成对**设置，所以用一个助手而不是逐个手写：
 * `gachaOutput = true` 单独设不违反任何 CHECK（约束禁止的是 `tradable AND
 * gacha_output` 同时为真），于是「加了奖池档位但忘了关 tradable」既不会被数据库
 * 拦住，也不会有任何报错 —— 它只是静默地把开箱变现的通道打开。
 */
function gachaLoot(seed: AssetSeed): AssetSeed {
  return { ...seed, tradable: false, gachaOutput: true };
}

function skin(
  code: string,
  name: string,
  price: number,
  sortOrder: number,
): AssetSeed {
  return {
    code,
    kind: 'unique',
    name,
    tradable: true,
    sortOrder,
    meta: {
      itemType: 'skin',
      slot: 'body',
      price,
      priceAsset: GAME_COIN,
      comfort: 0,
    },
  };
}

function accessory(
  code: string,
  name: string,
  slot: string,
  price: number,
  sortOrder: number,
): AssetSeed {
  return {
    code,
    kind: 'unique',
    name,
    tradable: true,
    sortOrder,
    meta: {
      itemType: 'accessory',
      slot,
      price,
      priceAsset: GAME_COIN,
      comfort: 0,
    },
  };
}

/** P2 Petpet：unique 收集品，槽位固定 `pet`，带被动加成（走 PetBonusService）。 */
function petpet(
  code: string,
  name: string,
  price: number,
  sortOrder: number,
  bonus: {
    offlineRate?: number;
    expGain?: number;
    raceScore?: number;
    moodDecay?: number;
  },
  rarity: string,
): AssetSeed {
  return {
    code,
    kind: 'unique',
    name,
    tradable: true,
    sortOrder,
    meta: {
      itemType: 'petpet',
      slot: 'pet',
      price,
      priceAsset: GAME_COIN,
      comfort: 0,
      bonus,
      rarity,
    },
  };
}

function furniture(
  code: string,
  name: string,
  price: number,
  comfort: number,
  gridW: number,
  gridH: number,
  sortOrder: number,
): AssetSeed {
  return {
    code,
    kind: 'stackable',
    name,
    tradable: true,
    sortOrder,
    meta: {
      itemType: 'furniture',
      slot: null,
      price,
      priceAsset: GAME_COIN,
      comfort,
      gridW,
      gridH,
    },
  };
}

function consumable(
  code: string,
  name: string,
  price: number,
  sortOrder: number,
): AssetSeed {
  return {
    code,
    kind: 'stackable',
    name,
    tradable: true,
    sortOrder,
    meta: {
      itemType: 'consumable',
      slot: null,
      price,
      priceAsset: GAME_COIN,
      comfort: 0,
    },
  };
}

/**
 * 满减券。
 *
 * `price: 0` 是「不可在商店直接买」：券只能从兑换中心用营销积分换，
 * 走商店买等于开了「游戏币 → 券 → 线下折扣」的通道，绕过营销积分这道闸。
 *
 * `redeemable: true` 会被 DB CHECK 反推成 `tradable: false`，这里显式写出来
 * 是为了让读代码的人不必去查约束才知道券不可流转。
 */
function discountCoupon(
  code: string,
  name: string,
  threshold: number,
  deduct: number,
  expireDays: number,
  sortOrder: number,
): AssetSeed {
  return {
    code,
    kind: 'stackable',
    name,
    tradable: false,
    redeemable: true,
    expireDays,
    sortOrder,
    meta: {
      itemType: 'coupon',
      slot: null,
      price: 0,
      priceAsset: MARKETING_POINT,
      comfort: 0,
      /** 满减门槛（分）。满 `threshold` 才能用 */
      couponThreshold: threshold,
      /** 减免金额（分） */
      couponDeduct: deduct,
    },
  };
}
