import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 玩家身份表。以 unionid 为主身份（若已绑微信开放平台），否则退化用 openid。
 *
 * 与账本的 `Account` 是两件事，别按名字混淆：本表回答「你是谁」，
 * `account` 回答「你的钱和物记在哪个账户上」。一个玩家在本表恒有一行，
 * 而账本账户是首次发生资产变动时才懒建的。
 *
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

  /**
   * 账号登录用户名（脱离微信的通用身份）。仅「账号登录 / 设备绑定账号」的玩家写入，
   * 微信/设备/mock 玩家为 null。唯一索引允许多个 null（Postgres 语义），
   * 故不影响无用户名的绝大多数玩家。
   *
   * 独立于 openid：设备玩家绑定账号后 openid 仍是 `device_openid_*`（设备登录照常命中），
   * 账号登录则按本列查找，两条路互不干扰。
   */
  @Index('uq_user_username', { unique: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  username: string | null;

  /**
   * 账号密码散列（仅账号登录/绑定的玩家使用；其余为 null）。
   * 存储格式同后台：`scrypt$<saltHex>$<hashHex>`，绝不落明文。
   */
  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  passwordHash: string | null;

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
   * 玩家最后一次被服务端「看到」的时间。登录/关键写操作时刷新。
   *
   * 注意：离线结算**不看这个字段**，而是以 `offline_base_at` 为基准
   * （`elapsed = now − offline_base_at`，再按 `pet.offline.maxHours` 封顶）。
   * 客户端没有任何申报时长的入口 —— 接口只收 `bizId`，多传字段会被直接 400。
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
