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

  /**
   * 关系只为声明外键而存在（不做 eager/join 查询）。
   * 少了它，`migration:generate` 会认为库里那条外键是多余的并生成 DROP。
   */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'condition_key', type: 'varchar', length: 32 })
  conditionKey: string;

  /** 服务端判定的起病时刻。 */
  @Column({ type: 'timestamptz' })
  since: Date;

  /**
   * 自愈计时锚点：巡检首次观察到该病症对应属性回到 `pet.cure.selfHealStat`
   * 以上的时刻。属性掉回阈值以下则清空，重新计时。
   *
   * 必须落列而不是从属性推算：属性只能推出「此刻是否达标」，
   * 推不出「已经达标多久」。而后者正是自愈的判定条件。
   * 用 `pet.last_seen_at` 代替也不行——玩家每次互动都会刷新它，
   * 于是越是精心照顾的宠物越永远等不到自愈。
   */
  @Column({ name: 'healthy_since', type: 'timestamptz', nullable: true })
  healthySince: Date | null;

  @Column({ name: 'cured_at', type: 'timestamptz', nullable: true })
  curedAt: Date | null;

  /** 'item' | 'clinic' | 'self' */
  @Column({ name: 'cured_by', type: 'varchar', length: 16, nullable: true })
  curedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
