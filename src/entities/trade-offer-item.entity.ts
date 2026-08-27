import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type TradeSide = 'from' | 'to';

/**
 * 报价单中的一项物品（barter）。side 标明属于发起方还是接受方一侧。
 * 可堆叠走 asset_code + qty，唯一物品走 instance_id（二者互斥）。
 */
@Entity({ name: 'trade_offer_item' })
@Index('idx_trade_offer_item_offer', ['offerId'])
export class TradeOfferItem {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'offer_id', type: 'bigint' })
  offerId: string;

  @Column({ type: 'varchar', length: 8 })
  side: TradeSide;

  @Column({ name: 'asset_code', type: 'varchar', length: 48, nullable: true })
  assetCode: string | null;

  @Column({ type: 'bigint', nullable: true })
  qty: string | null;

  @Column({ name: 'instance_id', type: 'bigint', nullable: true })
  instanceId: string | null;
}
