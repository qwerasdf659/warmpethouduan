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
// P8 融合后加入 status：已融合（status='fused'）的幽灵宠不占出战唯一位。
@Index('uq_pet_active_per_user', ['userId'], {
  unique: true,
  where: "is_active = true AND status = 'active'",
})
// P8：有效宠物查询的兜底索引（8 处 userId 查询统一走 status='active'）
@Index('idx_pet_active_status', ['userId'], {
  where: "status = 'active'",
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

  /** P10 性格特质：存 key 数组（如 ["greedy","sleepy"]），终身不变。名称/数值在配置里。 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  traits: string[];

  /** P3 皮肤基因：两个花色基因，前端不可见。产蛋时定死，孵化不再随机。 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  genes: string[];

  /** P3 繁殖冷却到期时刻；null = 不在冷却中。 */
  @Column({ name: 'breed_cooldown_until', type: 'timestamptz', nullable: true })
  breedCooldownUntil: Date | null;

  /** P8 形态：normal | glow | rainbow（融合提升）。 */
  @Column({ type: 'varchar', length: 16, default: 'normal' })
  form: string;

  /** P8 稀有度 key（对齐 items.rarities）。 */
  @Column({ type: 'varchar', length: 16, default: 'common' })
  rarity: string;

  /** P8 生命状态：active | fused（材料宠软失效，不 DELETE，保血统可追溯）。 */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  /** P13 累计陪玩次数（技巧解锁前提；daily 域的按日 Redis 键无法承载累计语义）。 */
  @Column({ name: 'play_count', type: 'int', default: 0 })
  playCount: number;

  /** P3 繁殖遗传的体力上限加成（基点，1000=+10%）；非繁殖出身恒为 0。 */
  @Column({ name: 'stamina_bonus_bps', type: 'int', default: 0 })
  staminaBonusBps: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
