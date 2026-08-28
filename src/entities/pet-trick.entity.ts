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
 * 宠物已学技巧（P13）。熟练度 0~100，练习提升、表演产出。
 */
@Entity({ name: 'pet_trick' })
@Index('uq_pet_trick', ['petId', 'trickKey'], { unique: true })
@Index('idx_pet_trick_user', ['userId'])
export class PetTrick {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'pet_id', type: 'bigint' })
  petId: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  /**
   * 关系只为声明外键而存在（不做 eager/join 查询）。
   * 少了它，`migration:generate` 会认为库里那条外键是多余的并生成 DROP。
   */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'trick_key', type: 'varchar', length: 32 })
  trickKey: string;

  /** 0~100 */
  @Column({ type: 'int', default: 0 })
  proficiency: number;

  @Column({ name: 'learned_at', type: 'timestamptz' })
  learnedAt: Date;

  @Column({ name: 'last_practice_at', type: 'timestamptz', nullable: true })
  lastPracticeAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
