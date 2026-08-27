import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 宠物病症（P1）。
 *
 * 病症必须持久化：治愈状态无法从属性派生（治好后饱食度仍是 0，下次请求会重新判定生病）。
 * 部分唯一索引 uq_pet_condition_active 是并发防线：同一宠同一种病不可能有两条活跃记录。
 */
@Entity({ name: 'pet_condition' })
@Index('uq_pet_condition_active', ['petId', 'conditionKey'], {
  unique: true,
  where: 'cured_at IS NULL',
})
@Index('idx_pet_condition_user', ['userId', 'curedAt'])
export class PetCondition {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'pet_id', type: 'bigint' })
  petId: string;

  /** 冗余，避免按 user 查时 join pet。 */
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'condition_key', type: 'varchar', length: 32 })
  conditionKey: string;

  /** 服务端判定的起病时刻。 */
  @Column({ type: 'timestamptz' })
  since: Date;

  @Column({ name: 'cured_at', type: 'timestamptz', nullable: true })
  curedAt: Date | null;

  /** 'item' | 'clinic' | 'self' */
  @Column({ name: 'cured_by', type: 'varchar', length: 16, nullable: true })
  curedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
