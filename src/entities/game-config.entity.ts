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
 * 说明：MVP 阶段各玩法数值仍以代码常量为权威，本表用于集中登记/展示可调项，
 * 并为「热更新」预留落点——后续可让对应服务优先读本表、缺省回退常量。
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
