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

/**
 * 玩家每日态（签到 + 每日任务领取记录）。一个玩家一行。
 *
 * 设计取舍：不为每天建一行（会无限膨胀），而是单行滚动：
 *  - 签到用 last_checkin_day + streak 表达连签，跨自然日即失效重置；
 *  - 每日任务的「已领取」用 task_day + claimed_tasks(JSON) 表达，task_day 变化即视为清零。
 * 任务**进度**不落库，由 Redis 计数器（act:{userId}:{day}）实时提供，服务端权威。
 */
@Entity('daily')
export class Daily {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_daily_user_id', { unique: true })
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** 最近一次签到的业务日键（东八区 yyyymmdd）；null 表示从未签到。 */
  @Column({
    name: 'last_checkin_day',
    type: 'varchar',
    length: 8,
    nullable: true,
  })
  lastCheckinDay: string | null;

  /** 连续签到天数（跨日断签重置为 1）。 */
  @Column({ name: 'streak', type: 'int', default: 0 })
  streak: number;

  /** 累计签到天数。 */
  @Column({ name: 'total_checkins', type: 'int', default: 0 })
  totalCheckins: number;

  /** claimed_tasks 所属的业务日键；与当前业务日不一致视为新的一天（清零）。 */
  @Column({ name: 'task_day', type: 'varchar', length: 8, nullable: true })
  taskDay: string | null;

  /** 当日已领取的任务 key 列表。 */
  @Column({ name: 'claimed_tasks', type: 'jsonb', default: [] })
  claimedTasks: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
