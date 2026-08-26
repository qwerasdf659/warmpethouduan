import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** `fixed` = 一价寄售（期 4）；`auction` = 自由竞价（期 5）。 */
export type ListingMode = 'fixed' | 'auction';
export type ListingStatus = 'listed' | 'sold' | 'cancelled' | 'expired';

/**
 * 市场挂单。挂单期间标的转入 `ESCROW` 账户（唯一物品）或转为 `frozen`（可堆叠），
 * 因此「挂着卖同时又送人」不可能。
 */
@Entity('market_listing')
@Check('ck_listing_mode', `"mode" IN ('fixed','auction')`)
@Check(
  'ck_listing_status',
  `"status" IN ('listed','sold','cancelled','expired')`,
)
@Check('ck_listing_price', `"price" > 0`)
@Check('ck_listing_fee_bps', `"fee_bps" >= 0 AND "fee_bps" <= 10000`)
@Check(
  'ck_listing_subject',
  `("qty" IS NOT NULL AND "qty" > 0 AND "instance_id" IS NULL) OR
   ("qty" IS NULL AND "instance_id" IS NOT NULL)`,
)
@Index('idx_listing_browse', ['assetCode', 'status', 'price'])
@Index('idx_listing_expire', ['status', 'expiresAt'])
@Index('idx_listing_seller', ['sellerAccountId', 'status'])
export class MarketListing {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'seller_account_id', type: 'bigint' })
  sellerAccountId: string;

  @Column({ type: 'varchar', length: 16 })
  mode: ListingMode;

  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  /** 可堆叠标的的件数；唯一物品为 null（二者互斥，CHECK 兜底） */
  @Column({ type: 'bigint', nullable: true })
  qty: string | null;

  @Column({ name: 'instance_id', type: 'bigint', nullable: true })
  instanceId: string | null;

  @Column({ name: 'price_asset', type: 'varchar', length: 48 })
  priceAsset: string;

  /** 一价模式为成交价；竞价模式为起拍价 */
  @Column({ type: 'bigint' })
  price: string;

  /**
   * 手续费率快照（万分比）。
   *
   * 落快照而非成交时读配置：手续费率调整**不能改变历史成交的分账口径**，
   * 否则对账时算出来的卖家应得与实际到账不符，且无从复原当时的费率。
   */
  @Column({ name: 'fee_bps', type: 'int' })
  feeBps: number;

  @Column({ type: 'varchar', length: 16, default: 'listed' })
  status: ListingStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'created_txn_id', type: 'bigint' })
  createdTxnId: string;

  @Column({ name: 'settled_txn_id', type: 'bigint', nullable: true })
  settledTxnId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
