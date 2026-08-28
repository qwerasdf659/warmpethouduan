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
 * 玩家活动任务进度（P12）。唯一索引 = 「每玩家每活动每任务一行」。
 */
@Entity({ name: 'event_progress' })
@Index('uq_event_progress', ['userId', 'eventKey', 'taskKey'], { unique: true })
export class EventProgress {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  /**
   * 关系只为声明外键而存在（不做 eager/join 查询）。
   * 少了它，`migration:generate` 会认为库里那条外键是多余的并生成 DROP。
   */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'event_key', type: 'varchar', length: 48 })
  eventKey: string;

  @Column({ name: 'task_key', type: 'varchar', length: 48 })
  taskKey: string;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
