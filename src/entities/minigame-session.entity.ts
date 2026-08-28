import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

export type MinigameSessionStatus = 'open' | 'settled' | 'expired';

/**
 * 对局进行中的状态。**牌面本身不存**——它由 `seed` 确定性推导，
 * 存进来只会多一份可能与 seed 不一致的真相。
 */
export interface MinigameBoardState {
  /** 已配对成功的牌位下标 */
  matched: number[];
  /** 已完成的翻牌尝试次数（每次两张） */
  attempts: number;
  /** 当前这轮已翻开的第一张（null = 还没翻） */
  pending: number | null;
}

export const MINIGAME_INITIAL_STATE: MinigameBoardState = {
  matched: [],
  attempts: 0,
  pending: null,
};

/**
 * 小游戏对局（P11）。
 *
 * 服务端权威的做法是**服务端独占牌面**：`start` 只下发 seed 与牌位数，
 * 牌面由 seed 推导且从不下发；玩家每次 `flip` 由服务端揭示一张并记录进 `state`；
 * `settle` 完全按服务端自己记的 `state` 算分，不接受任何客户端上报的过程数据。
 *
 * 这也是为什么不能用「客户端批量提交操作序列」那种形态：那种形态下要么牌面得
 * 提前下发（客户端可以直接算出满分序列），要么牌面保密（客户端只能瞎翻），
 * 两者都不成立。
 */
@Entity({ name: 'minigame_session' })
@Index('uq_minigame_biz', ['userId', 'bizId'], { unique: true })
@Index('idx_minigame_user', ['userId', 'status', 'expiresAt'])
export class MinigameSession {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  /**
   * 关系只为声明外键而存在（不做 eager/join 查询）。
   * 少了它，`migration:generate` 会认为库里那条外键是多余的并生成 DROP。
   */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

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

  /**
   * 翻牌进度（服务端独占，客户端只能通过 flip 推进）。
   *
   * ⚠ 默认值字符串必须与 **Postgres 规范化后**的形态逐字一致（键按长度再按字典序、
   * 冒号后带空格）。写成紧凑 JSON 的话，`migration:generate` 会认为实体与库有差异、
   * 每次都生成一条「重设默认值」的空迁移，CI 的 drift 闸会因此常红。
   */
  @Column({
    type: 'jsonb',
    default: () => `'{"matched": [], "pending": null, "attempts": 0}'`,
  })
  state: MinigameBoardState;

  @Column({ type: 'int', nullable: true })
  score: number | null;

  @Column({ name: 'reward_coin', type: 'int', default: 0 })
  rewardCoin: number;

  @Column({ name: 'biz_id', type: 'varchar', length: 128 })
  bizId: string;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;
}
