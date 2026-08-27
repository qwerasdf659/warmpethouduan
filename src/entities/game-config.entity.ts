import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 运营可调配置的 KV 存储（后台配置中心）。value 用 jsonb 承载任意结构。
 *
 * 本表是玩法数值的**运行时权威**：`GameConfigService` 优先读它，仅在行缺失或
 * 值非法时才回退代码里的默认值。代码侧的 `CONFIG_REGISTRY` 只负责两件事——
 * 定义 Joi schema、提供新库播种用的默认值，它不是权威源。
 *
 * 因此**禁止用迁移脚本 UPDATE 本表的值**：那会让「当前生效值为什么是这个」
 * 的答案散落在代码、库、迁移三处。数值调整一律走后台，自动过 schema 校验、
 * 自动写审计日志、自动失效缓存。
 */
@Entity('game_config')
export class GameConfig {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_game_config_key', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'varchar', length: 128, default: '' })
  description: string;

  @Column({ type: 'jsonb', default: {} })
  value: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
