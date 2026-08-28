import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 资产种类。决定它存在哪里：
 *  - `currency` / `stackable` → `asset_balance`（数量语义）+ `asset_lot`（批次）
 *  - `unique`                 → `item_instance`（身份语义，可交易、可编号）
 */
export type AssetKind = 'currency' | 'stackable' | 'unique';

/** 表现层字段。账本层不解释它们，只有目录/商店/家园读。 */
export interface AssetMeta {
  /** 表现层分类：skin | accessory | furniture | consumable | petpet | coupon（货币无此字段） */
  itemType?:
    'skin' | 'accessory' | 'furniture' | 'consumable' | 'petpet' | 'coupon';
  /** 换装槽位（body/hat/neck/bg/pet） */
  slot?: string | null;
  /** 售价（0 = 免费/不可售） */
  price?: number;
  /** 计价资产（用哪种货币买） */
  priceAsset?: string;
  /** 家具舒适度贡献 */
  comfort?: number;
  gridW?: number;
  gridH?: number;
  /** P2/P8 被动加成。只允许收益与衰减类键，不得含 speed/endurance */
  bonus?: {
    offlineRate?: number;
    expGain?: number;
    raceScore?: number;
    moodDecay?: number;
  };
  /** P8 稀有度 key（对齐 items.rarities） */
  rarity?: string;
  [k: string]: unknown;
}

/**
 * 资产定义。行式统一账本的配置源：新增币种是插一行，不是加一列。
 *
 * 账本层只关心 `kind`、三个合规开关、过期与限量；`slot`/`comfort`/`grid_*`/`price`
 * 等表现层字段一律收进 `meta`——它们变化频繁且只有渲染层读，放进列会让这张表
 * 变成谁都要改的热点。
 */
@Entity({ name: 'asset_def', synchronize: false })
@Check('ck_asset_kind', `"kind" IN ('currency','stackable','unique')`)
// 合规红线固化在库层，不靠文档和人记得住。放开需显式迁移 + 追加决策记录。
@Check('ck_asset_no_trade_redeem', `NOT ("tradable" AND "redeemable")`)
@Check('ck_asset_no_trade_gacha', `NOT ("tradable" AND "gacha_output")`)
@Check('ck_asset_expire_days', `"expire_days" IS NULL OR "expire_days" > 0`)
// 限量超发的结构性防线：任何路径都改不出 minted_count > mint_limit
@Check(
  'ck_asset_mint_limit',
  `"mint_limit" IS NULL OR "minted_count" <= "mint_limit"`,
)
@Check('ck_asset_cooldown', `"trade_cooldown_hours" >= 0`)
export class AssetDef {
  /** 稳定业务键（`game_coin`、`skin_tiger`、`furn_sofa`…） */
  @PrimaryColumn({ type: 'varchar', length: 48 })
  code: string;

  @Column({ type: 'varchar', length: 16 })
  kind: AssetKind;

  @Column({ type: 'varchar', length: 48 })
  name: string;

  /** 可在玩家间流转。与 `redeemable`/`gachaOutput` 互斥（CHECK 兜底） */
  @Column({ type: 'boolean', default: false })
  tradable: boolean;

  /** 可兑实物。可兑 ⇒ 禁止流转，否则形成变现闭环 */
  @Column({ type: 'boolean', default: false })
  redeemable: boolean;

  /** 扭蛋产出。可交易 + 随机产出 = 开箱变现模式，敏感度高于交易本身 */
  @Column({ name: 'gacha_output', type: 'boolean', default: false })
  gachaOutput: boolean;

  /** 获得后多久可交易（防盗号即刻套现） */
  @Column({ name: 'trade_cooldown_hours', type: 'int', default: 72 })
  tradeCooldownHours: number;

  /** 发行时按此计算批次到期日；NULL = 永不过期 */
  @Column({ name: 'expire_days', type: 'int', nullable: true })
  expireDays: number | null;

  /** NULL = 不限量 */
  @Column({ name: 'mint_limit', type: 'int', nullable: true })
  mintLimit: number | null;

  /** 已发行件数，由发行时的原子自增语句维护，同时充当限量编号 `serial` */
  @Column({ name: 'minted_count', type: 'int', default: 0 })
  mintedCount: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'jsonb', default: {} })
  meta: AssetMeta;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
