import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * 玩家已拥有的物品（背包）。一个玩家对同一 item_def 只持一行（qty 累计）。
 * 换装类通常 qty=1；家具类允许多件同款（qty>1，可多处摆放）。
 */
@Entity('item_owned')
@Index('uq_item_owned_user_item', ['userId', 'itemDefId'], { unique: true })
export class ItemOwned {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'item_def_id', type: 'bigint' })
  itemDefId: string;

  @Column({ type: 'int', default: 1 })
  qty: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
