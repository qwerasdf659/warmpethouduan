import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/** 兑换订单收货信息快照（实物才有）。 */
export interface RedeemAddressSnapshot {
  receiver: string;
  phone: string;
  region: string;
  detail: string;
}

/**
 * 兑换订单。下单即扣积分并落一行 pending；实物由运营后台发货（shipped）。
 * (user_id, biz_id) 唯一，保证按 bizId 幂等下单（配合钱包 apply 的持久幂等）。
 */
@Entity('redeem_order')
@Index('uq_redeem_user_biz', ['userId', 'bizId'], { unique: true })
@Index('idx_redeem_status_id', ['status', 'id'])
export class RedeemOrder {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'exchange_key', type: 'varchar', length: 48 })
  exchangeKey: string;

  @Column({ name: 'item_name', type: 'varchar', length: 64 })
  itemName: string;

  /** physical 实物 | virtual 虚拟 */
  @Column({ name: 'item_type', type: 'varchar', length: 16 })
  itemType: 'physical' | 'virtual';

  @Column({ type: 'int' })
  cost: number;

  @Column({ type: 'varchar', length: 16 })
  pool: 'game' | 'marketing';

  /** pending 待处理 | shipped 已发货/已发放 | cancelled 已取消(已退款) */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'shipped' | 'cancelled';

  @Column({ name: 'biz_id', type: 'varchar', length: 128 })
  bizId: string;

  /** 实物收货快照（虚拟为 null） */
  @Column({ type: 'jsonb', nullable: true })
  address: RedeemAddressSnapshot | null;

  /** 物流单号（发货后填写） */
  @Column({ name: 'tracking_no', type: 'varchar', length: 64, nullable: true })
  trackingNo: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
