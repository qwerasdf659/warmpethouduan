import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TradeOfferStatus =
  'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

/**
 * 双向易货报价单（barter）。发起方物品/币在建单时即冻结/托管（进场）；
 * 接受时双向结算；拒绝/撤销/超时则解冻（退出，不受 market 总闸约束）。
 */
@Entity({ name: 'trade_offer' })
@Index('uq_trade_offer_biz', ['fromUserId', 'bizId'], { unique: true })
@Index('idx_trade_offer_to', ['toUserId', 'status'])
@Index('idx_trade_offer_from', ['fromUserId', 'status'])
export class TradeOffer {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'from_user_id', type: 'bigint' })
  fromUserId: string;

  @Column({ name: 'to_user_id', type: 'bigint' })
  toUserId: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: TradeOfferStatus;

  /** 发起方额外附上的游戏币。 */
  @Column({ name: 'from_coin', type: 'bigint', default: 0 })
  fromCoin: string;

  /** 发起方要求对方附上的游戏币。 */
  @Column({ name: 'to_coin', type: 'bigint', default: 0 })
  toCoin: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'biz_id', type: 'varchar', length: 128 })
  bizId: string;

  @Column({ name: 'settled_txn_id', type: 'bigint', nullable: true })
  settledTxnId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
