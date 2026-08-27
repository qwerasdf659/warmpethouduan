import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 后台控制台自身的设置项（外观主题等），与玩法配置 `game_config` 分开存。
 *
 * 两者都是 KV，但受众和生命周期完全不同：`game_config` 的 key 由
 * `CONFIG_REGISTRY` 注册、全是玩法域（pet/gacha/market…），运营在「配置中心」
 * 页面直接编辑 JSON。后台主题混进去会出现在同一张表格里，既让运营误以为
 * 它影响玩法，又给了手改 JSON 改坏配色的机会；反过来也会让 `src/config`
 * 反向依赖 `src/admin`。
 */
@Entity('admin_setting')
export class AdminSetting {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_admin_setting_key', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'jsonb', default: {} })
  value: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
