import {
  Check,
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

/**
 * 钱包（余额快照）。一个玩家一行，双池**物理隔离、永不互转**：
 *  - game_coin       玩游戏产出，纯虚拟闭环，只换装扮/家具/加速，**不可兑实物**
 *  - marketing_point 线下扫码/异业消费等营销触点，可兑实物 + 虚拟
 *
 * 余额权威由 `ledger` 流水累加对账；本表是为了避免每次读都 SUM 全表的快照。
 * 金额用 bigint（避免浮点误差且留足量级），pg 驱动下以字符串返回。
 */
@Entity('wallet')
// 余额不可为负：应用层已用 `WHERE col + delta >= 0` 控流，这里是库层最终防线
@Check('ck_wallet_non_negative', '"game_coin" >= 0 AND "marketing_point" >= 0')
export class Wallet {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_wallet_user_id', { unique: true })
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'game_coin', type: 'bigint', default: 0 })
  gameCoin: string;

  @Column({ name: 'marketing_point', type: 'bigint', default: 0 })
  marketingPoint: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
