import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type BidStatus = 'active' | 'outbid' | 'won' | 'cancelled';

/**
 * 竞价出价（期 5）。出价即冻结买家资金（`freezeTxnId` 指向那张 `freeze` 凭证），
 * 被超越时解冻 —— 否则会出现「同一笔钱同时出价十个挂单，中标后余额不够」。
 */
@Entity('market_bid')
@Check('ck_bid_status', `"status" IN ('active','outbid','won','cancelled')`)
@Check('ck_bid_price', `"price" > 0`)
@Index('idx_bid_listing', ['listingId', 'price', 'createdAt'])
export class MarketBid {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'listing_id', type: 'bigint' })
  listingId: string;

  @Column({ name: 'bidder_account_id', type: 'bigint' })
  bidderAccountId: string;

  @Column({ type: 'bigint' })
  price: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: BidStatus;

  @Column({ name: 'freeze_txn_id', type: 'bigint' })
  freezeTxnId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
