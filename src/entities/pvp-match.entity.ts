import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 对手宠物属性快照，战报要能复现（对方随后升级/换装不改历史战报）。 */
export interface PvpOpponentSnapshot {
  userId: string;
  nickname: string | null;
  level: number;
  speed: number;
  endurance: number;
  stage: string;
  appearance: Record<string, string>;
}

/**
 * PvP 对局记录（P4）。opponent_snapshot 落 jsonb 而非引用对方当前宠物。
 * 两个方向索引：「复仇」要查「谁挑战过我」。pet_id 不加 FK（与现状一致，见 §13.2）。
 */
@Entity({ name: 'pvp_match' })
@Index('uq_pvp_match_biz', ['challengerUserId', 'bizId'], { unique: true })
@Index('idx_pvp_match_mine', ['challengerUserId', 'id'])
@Index('idx_pvp_match_theirs', ['opponentUserId', 'id'])
export class PvpMatch {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 16 })
  season: string;

  @Column({ name: 'challenger_user_id', type: 'bigint' })
  challengerUserId: string;

  @Column({ name: 'opponent_user_id', type: 'bigint' })
  opponentUserId: string;

  @Column({ name: 'track_key', type: 'varchar', length: 32 })
  trackKey: string;

  @Column({ name: 'challenger_time', type: 'numeric', precision: 6, scale: 2 })
  challengerTime: string;

  @Column({ name: 'opponent_time', type: 'numeric', precision: 6, scale: 2 })
  opponentTime: string;

  @Column({ type: 'boolean' })
  win: boolean;

  @Column({ name: 'rank_point_delta', type: 'int' })
  rankPointDelta: number;

  @Column({ name: 'reward_coin', type: 'int', default: 0 })
  rewardCoin: number;

  @Column({ name: 'opponent_snapshot', type: 'jsonb' })
  opponentSnapshot: PvpOpponentSnapshot;

  @Column({ name: 'biz_id', type: 'varchar', length: 128 })
  bizId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
