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
 * 家园摆放实例。每行 = 一件已摆放的家具及其坐标。
 * 同款家具可摆多件（对应多行），受背包 qty 约束。
 */
@Entity('home_layout')
@Index('idx_home_layout_user', ['userId'])
export class HomeLayout {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'item_def_id', type: 'bigint' })
  itemDefId: string;

  @Column({ name: 'pos_x', type: 'int', default: 0 })
  posX: number;

  @Column({ name: 'pos_y', type: 'int', default: 0 })
  posY: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
