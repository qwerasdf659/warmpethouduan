import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ClinicCaseStatus = 'open' | 'answered' | 'expired';

export interface ClinicOption {
  key: string;
  name: string;
}

/**
 * 接诊病例（P7）。
 *
 * ⚠ answer_key 落库但**绝不出现在任何出参**里（出参 DTO 显式挑字段，不用 spread），
 * 否则客户端一改就无限刷币。
 */
@Entity({ name: 'clinic_case' })
@Index('idx_clinic_case_user', ['userId', 'status', 'expiresAt'])
export class ClinicCase {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  /** 复用 pet.conditions 的病症目录。 */
  @Column({ name: 'condition_key', type: 'varchar', length: 32 })
  conditionKey: string;

  @Column({ type: 'jsonb' })
  symptoms: string[];

  /** 候选方案（不含答案）。 */
  @Column({ type: 'jsonb' })
  options: ClinicOption[];

  /** ⚠ 永不下发。 */
  @Column({ name: 'answer_key', type: 'varchar', length: 32 })
  answerKey: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: ClinicCaseStatus;

  @Column({ name: 'answered_key', type: 'varchar', length: 32, nullable: true })
  answeredKey: string | null;

  @Column({ type: 'boolean', nullable: true })
  correct: boolean | null;

  @Column({ name: 'reward_coin', type: 'int', default: 0 })
  rewardCoin: number;

  @Column({ name: 'biz_id', type: 'varchar', length: 128, nullable: true })
  bizId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
