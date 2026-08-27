import type { AssetView } from '../ledger/asset-catalog.service';
import type {
  ListingMode,
  ListingStatus,
} from '../entities/market-listing.entity';

/** 交易标的：可堆叠资产按件数，唯一物品按实例。 */
export type Subject =
  { assetCode: string; qty: number } | { instanceId: string };

/** 标的解析结果：把两种形态统一成后续流程能直接用的字段。 */
export interface ResolvedSubject {
  def: AssetView;
  assetCode: string;
  /** 可堆叠标的的件数；唯一物品为 null */
  qty: number | null;
  instanceId: string | null;
  /** 参考价（商店定价 × 件数），用于限价与额度累计 */
  referenceValue: number;
}

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
