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

/** 玩家收货地址（实物兑换履约用）。 */
@Entity('user_address')
@Index('idx_user_address_user', ['userId'])
export class UserAddress {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 32 })
  receiver: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  /** 省市区（合并存储，MVP 不拆分行政区划） */
  @Column({ type: 'varchar', length: 128 })
  region: string;

  @Column({ type: 'varchar', length: 255 })
  detail: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
