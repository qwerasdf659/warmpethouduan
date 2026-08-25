import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 账户表。以 unionid 为主身份（若已绑微信开放平台），否则退化用 openid。
 * 注意：bigint 主键在 pg 驱动下以字符串返回，业务层统一按 string 处理。
 */
@Entity('user')
export class User {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_user_unionid', { unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  unionid: string | null;

  @Index('uq_user_openid', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  openid: string;

  /** 账号状态：active 正常 | banned 封禁。封禁后拒绝登录与宠物写操作。 */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'banned';

  /** 封禁原因（运营填写，审计与前端展示用）。 */
  @Column({
    name: 'banned_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  bannedReason: string | null;

  /** 封禁时间（服务端时间）。 */
  @Column({ name: 'banned_at', type: 'timestamptz', nullable: true })
  bannedAt: Date | null;

  /**
   * 玩家最后一次被服务端「看到」的时间。离线结算的时间基准：
   * elapsed = min(客户端申报, now − last_seen_at)。登录/关键写操作时刷新。
   */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  /**
   * 离线收益的累计基准时间。每次领取离线收益后重置为服务端 now；
   * 与 last_seen_at 分离，避免登录刷新 last_seen_at 冲掉未领取的离线时长。
   */
  @Column({ name: 'offline_base_at', type: 'timestamptz', nullable: true })
  offlineBaseAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
