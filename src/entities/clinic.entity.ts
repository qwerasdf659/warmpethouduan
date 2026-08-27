import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 玩家诊所（P7）。一玩家一行（user_id 主键）。星级由正确率派生。
 */
@Entity({ name: 'clinic' })
export class Clinic {
  @PrimaryColumn({ name: 'user_id', type: 'bigint' })
  userId: string;

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
