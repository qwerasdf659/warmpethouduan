import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 天梯积分（P4）。一个玩家一行（user_id 主键），赛季切换后 rank_point 由结算重置。
 * idx_pvp_rank_board 支撑「按 rank_point 排序取榜」与「按分差带宽匹配」。
 */
@Entity({ name: 'pvp_rank' })
@Index('idx_pvp_rank_board', ['season', 'rankPoint', 'updatedAt'])
export class PvpRank {
  @PrimaryColumn({ name: 'user_id', type: 'bigint' })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  season: string;

  @Column({ name: 'rank_point', type: 'int', default: 1000 })
  rankPoint: number;

  @Column({ type: 'int', default: 0 })
  wins: number;

  @Column({ type: 'int', default: 0 })
  losses: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
