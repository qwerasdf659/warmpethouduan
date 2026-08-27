import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type MinigameSessionStatus = 'open' | 'settled' | 'expired';

/**
 * 小游戏对局（P11）。服务端下发 seed，settle 用同一 seed 回放算分——客户端分数不采信。
 */
@Entity({ name: 'minigame_session' })
@Index('uq_minigame_biz', ['userId', 'bizId'], { unique: true })
@Index('idx_minigame_user', ['userId', 'status', 'expiresAt'])
export class MinigameSession {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ name: 'game_key', type: 'varchar', length: 32 })
  gameKey: string;

  @Column({ type: 'varchar', length: 64 })
  seed: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: MinigameSessionStatus;

  @Column({ type: 'int', nullable: true })
  score: number | null;

  @Column({ name: 'reward_coin', type: 'int', default: 0 })
  rewardCoin: number;

  @Column({ name: 'biz_id', type: 'varchar', length: 128 })
  bizId: string;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;
}
