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
 * 赛跑记录。start 时落一行 status='pending'（结果已由服务端算定并存好），
 * settle 时发奖并置 status='settled'。把「结果算定」放在 start、把「发奖」放在 settle，
 * 既保证服务端权威（客户端无法影响名次），又能支持前端播放赛跑动画后再结算领奖。
 */
@Entity('race_record')
@Index('idx_race_user_id_id', ['userId', 'id'])
// 影子采样按「赛道 + 等级带 + 时间」捞成绩，没这条索引会全表扫
@Index('idx_race_ghost_sample', ['trackKey', 'petLevel', 'createdAt'])
@Index('uq_race_record_user_biz', ['userId', 'bizId'], { unique: true })
export class RaceRecord {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  /**
   * 报名时的业务幂等键，`(user_id, biz_id)` 唯一。
   *
   * 和 gacha_draw 同理：只靠 `IdempotencyInterceptor`（Redis，24h TTL）不够。
   * 门票扣费走经济域的**永久**幂等（ledger 唯一索引无 TTL），两边 TTL 一旦不对称，
   * 拿一个超过 24h 的旧 bizId 重放 start 就会「门票被幂等吃掉、却新建一场可结算的
   * 比赛」——等于免费赛。这一列把去重也做成永久的，补上那道缺口。
   *
   * 可空：本列加入前的历史记录没有该键；Postgres 唯一索引视 NULL 互不相等，
   * 老行不会互相冲突。
   */
  @Column({ name: 'biz_id', type: 'varchar', length: 128, nullable: true })
  bizId: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'pet_id', type: 'bigint' })
  petId: string;

  @Column({ name: 'track_key', type: 'varchar', length: 32 })
  trackKey: string;

  @Column({ name: 'pet_level', type: 'int' })
  petLevel: number;

  /**
   * 战力快照（speed×2 + endurance 取整）。
   * ⚠ **不再决定名次**——名次由 `finish_time` 升序排出，这一列只留作数值分析
   * 与历史记录的可比对锚点（旧记录的 rank 就是按它算的）。
   */
  @Column({ type: 'int' })
  score: number;

  /**
   * 完赛时间（秒，3 位小数）。判定的核心量：名次与评级都由它派生。
   * 旧记录（战力模型时期）为 null，影子采样会跳过这些行。
   */
  @Column({
    name: 'finish_time',
    type: 'numeric',
    precision: 10,
    scale: 3,
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  finishTime: number | null;

  /** 评级 S/A/B/C（完赛时间比对赛道基准时间）。旧记录为 null。 */
  @Column({ type: 'varchar', length: 2, nullable: true })
  grade: 'S' | 'A' | 'B' | 'C' | null;

  /**
   * 本场影子来源：`player` 全部采自真实玩家成绩、`mixed` 部分采样、
   * `npc` 全部由服务端生成。用于排查「这场对手怎么这么快」。
   */
  @Column({
    name: 'ghost_source',
    type: 'varchar',
    length: 8,
    nullable: true,
  })
  ghostSource: 'player' | 'mixed' | 'npc' | null;

  /** 最终名次（1 起） */
  @Column({ type: 'int' })
  rank: number;

  /** 参赛总数（玩家 + 对手） */
  @Column({ name: 'total_racers', type: 'int' })
  totalRacers: number;

  /** 应发奖励游戏币（settle 时发放） */
  @Column({ name: 'reward_coin', type: 'int', default: 0 })
  rewardCoin: number;

  @Column({ name: 'stamina_cost', type: 'int', default: 0 })
  staminaCost: number;

  /** pending 待结算 | settled 已发奖 */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'settled';

  /** 是否已看广告翻倍（每场至多一次，兼作发放去重的库层防线） */
  @Column({ name: 'reward_doubled', type: 'boolean', default: false })
  rewardDoubled: boolean;

  /** 已看广告复活重跑的次数（受 RACE_REVIVE.maxPerRace 约束） */
  @Column({ name: 'revive_count', type: 'int', default: 0 })
  reviveCount: number;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
