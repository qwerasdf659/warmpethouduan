import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type EggStatus = 'incubating' | 'hatched' | 'cancelled';

/**
 * 宠物蛋（P3）。
 *
 * 遗传结果（species/genes/traits/stamina_bonus）在**产蛋时**就算完并落库：
 * 孵化退化成纯建行，天然可重放（幂等）。基因不下发（前端不可见）。
 */
@Entity({ name: 'pet_egg' })
@Index('uq_pet_egg_biz', ['userId', 'bizId'], { unique: true })
@Index('idx_pet_egg_user', ['userId', 'status'])
export class PetEgg {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'parent_a_id', type: 'bigint' })
  parentAId: string;

  @Column({ name: 'parent_b_id', type: 'bigint' })
  parentBId: string;

  /** 产蛋时即定，不在孵化时再随机。 */
  @Column({ type: 'varchar', length: 32 })
  species: string;

  /** 两个皮肤基因，前端不可见。 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  genes: string[];

  /** 继承自 P10 的特质 key 数组。 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  traits: string[];

  @Column({ name: 'stamina_bonus_bps', type: 'int', default: 0 })
  staminaBonusBps: number;

  @Column({ name: 'hatch_at', type: 'timestamptz' })
  hatchAt: Date;

  @Column({ type: 'varchar', length: 16, default: 'incubating' })
  status: EggStatus;

  @Column({ name: 'hatched_pet_id', type: 'bigint', nullable: true })
  hatchedPetId: string | null;

  @Column({ name: 'biz_id', type: 'varchar', length: 128 })
  bizId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
