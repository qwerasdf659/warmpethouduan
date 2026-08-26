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
@Index('idx_home_layout_asset', ['userId', 'assetCode'])
export class HomeLayout {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** 摆放的家具资产 code。家具是 `stackable`，同款多件靠多行摆放行表达 */
  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  @Column({ name: 'pos_x', type: 'int', default: 0 })
  posX: number;

  @Column({ name: 'pos_y', type: 'int', default: 0 })
  posY: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
