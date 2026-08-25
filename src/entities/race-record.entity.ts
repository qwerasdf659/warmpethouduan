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
export class RaceRecord {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'pet_id', type: 'bigint' })
  petId: string;

  @Column({ name: 'track_key', type: 'varchar', length: 32 })
  trackKey: string;

  @Column({ name: 'pet_level', type: 'int' })
  petLevel: number;

  /** 玩家战力得分（服务端算定） */
  @Column({ type: 'int' })
  score: number;

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
