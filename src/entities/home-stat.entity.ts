import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * 家园聚合态。comfort = 已摆放家具的舒适度之和（快照，摆放/收纳时增量维护），
 * 供宠物心情衰减减免（comfortFactor）快速读取，免每次 SUM home_layout。
 */
@Entity('home_stat')
export class HomeStat {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_home_stat_user', { unique: true })
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'int', default: 0 })
  comfort: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
