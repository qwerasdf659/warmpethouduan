import type {
  ListingMode,
  ListingStatus,
} from '../entities/market-listing.entity';

/** 挂单对外视图（浏览、我的挂单、下单回执共用）。 */
export interface ListingView {
  id: string;
  sellerUserId: string | null;
  mode: ListingMode;
  assetCode: string;
  assetName: string;
  qty: number | null;
  instanceId: string | null;
  serial: number | null;
  priceAsset: string;
  price: number;
  feeBps: number;
  status: ListingStatus;
  expiresAt: string;
  createdAt: string;
  /** 竞价模式下的当前最高价（无人出价则为 null） */
  topBid: number | null;
}

/** `market_listing` 行的原始形状（查询层内部使用）。 */
export interface ListingRow {
  id: string;
  seller_account_id: string;
  mode: ListingMode;
  asset_code: string;
  qty: string | null;
  instance_id: string | null;
  price_asset: string;
  price: string;
  fee_bps: number;
  status: ListingStatus;
  expires_at: Date;
  created_at: Date;
}
