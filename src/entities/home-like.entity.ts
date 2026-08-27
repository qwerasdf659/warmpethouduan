import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 家园点赞（P9）。like_day 用 varchar(10) 业务日（UTC+8），与 daily.last_checkin_day 一致，
 * 不依赖数据库时区。唯一索引 = 「每人每天对同一目标只能赞一次」。
 */
@Entity({ name: 'home_like' })
@Index('uq_home_like_daily', ['fromUserId', 'toUserId', 'likeDay'], {
  unique: true,
})
@Index('idx_home_like_to', ['toUserId', 'likeDay'])
export class HomeLike {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'from_user_id', type: 'bigint' })
  fromUserId: string;

  @Column({ name: 'to_user_id', type: 'bigint' })
  toUserId: string;

  /** 业务日 YYYY-MM-DD（UTC+8）。 */
  @Column({ name: 'like_day', type: 'varchar', length: 10 })
  likeDay: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
