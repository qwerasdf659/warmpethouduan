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
 * 宠物表。**多宠**：一个 user 可有多条 pet（user_id 非唯一），
 * 其中 is_active 标记当前出战/展示宠（每个 user 至多一只 active）。
 *
 * last_seen_at 存服务端时间（timestamptz，UTC），是该宠所有衰减/结算的基准。
 *
 * 注意：staminaMax / speed / endurance **不落库**，由 level 按成长曲线派生
 *（见 pet.config.ts）——属性只由养成决定，避免冗余列与数据漂移。
 */
@Entity('pet')
// 「每个 user 至多一只 active」用部分唯一索引在库层兜底，
// 而不是只靠应用层锁：并发/脚本/后台直改都绕不过去。
@Index('uq_pet_active_per_user', ['userId'], {
  unique: true,
  where: 'is_active = true',
})
export class Pet {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('idx_pet_user_id')
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** 昵称，玩家可改；为空时前端用默认名。 */
  @Column({ type: 'varchar', length: 32, nullable: true })
  nickname: string | null;

  /** 品种/花色。MVP 只一种品种多花色，用字符串键引用配置。 */
  @Column({ type: 'varchar', length: 32, default: 'default' })
  species: string;

  /** 当前出战/展示宠。每个 user 至多一只 true，由服务端保证。 */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** 饱食度 0–100 */
  @Column({ type: 'int', default: 80 })
  hunger: number;

  /** 心情 0–100（派生衰减，见 PetService） */
  @Column({ type: 'int', default: 80 })
  mood: number;

  /** 清洁度 0–100 */
  @Column({ type: 'int', default: 80 })
  cleanliness: number;

  /** 当前体力，上限由 level 派生 */
  @Column({ type: 'int', default: 100 })
  stamina: number;

  /** 亲密度，累计值，不衰减 */
  @Column({ type: 'int', default: 0 })
  intimacy: number;

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ type: 'int', default: 0 })
  exp: number;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
