import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type GameEventType = 'gacha_pool' | 'shop' | 'task' | 'login';

/**
 * 限时活动（P12）。建表而非塞配置：多活动并存、按时间窗口查询、运营要能增删改单个活动。
 */
@Entity({ name: 'game_event' })
@Index('idx_game_event_window', ['enabled', 'startsAt', 'endsAt'])
export class GameEvent {
  @PrimaryColumn({ type: 'varchar', length: 48 })
  key: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 24 })
  type: GameEventType;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  banner: string | null;

  /** 奖池/商品/任务链。 */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
