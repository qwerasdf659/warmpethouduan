import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * 玩家诊所（P7）。一玩家一行（user_id 主键）。星级由正确率派生。
 */
@Entity({ name: 'clinic' })
export class Clinic {
  @PrimaryColumn({ name: 'user_id', type: 'bigint' })
  userId: string;

  /**
   * 关系只为声明外键而存在（不做 eager/join 查询）。
   * 少了它，`migration:generate` 会认为库里那条外键是多余的并生成 DROP。
   */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @CreateDateColumn({ name: 'unlocked_at', type: 'timestamptz' })
  unlockedAt: Date;

  @Column({ type: 'int', default: 1 })
  star: number;

  @Column({ name: 'correct_count', type: 'int', default: 0 })
  correctCount: number;

  @Column({ name: 'total_count', type: 'int', default: 0 })
  totalCount: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
