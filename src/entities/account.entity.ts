import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/** 系统账户代码。只有两个：手续费归集与挂单托管，见架构设计 §2.2。 */
export type SystemCode = 'FEE' | 'ESCROW';

/**
 * 账本账户。玩家账户与系统账户共用一张表，使 `asset_entry` 只需一个 `account_id`
 * 外键就能表达「玩家↔玩家」「玩家↔系统」两类转移。
 *
 * 刻意**没有** `MINT`/`BURN` 系统账户：互动产币是全服最高频的写操作，若要求它有
 * 对手方分录，全服写入会被串行化在 MINT 账户的同一行上。发行与销毁本就是凭空
 * 产生和消失，守恒在此不成立，其口径由 `asset_daily_stat` 承担。
 */
@Entity({ name: 'account', synchronize: false })
@Check('ck_account_kind', `"kind" IN ('user','system')`)
@Check(
  'ck_account_ref',
  `("kind" = 'user'   AND "user_id" IS NOT NULL AND "system_code" IS NULL) OR
   ("kind" = 'system' AND "user_id" IS NULL     AND "system_code" IS NOT NULL)`,
)
export class Account {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 8 })
  kind: 'user' | 'system';

  /**
   * 玩家账户的归属。外键为 NO ACTION：有资金流水的玩家不允许硬删，
   * 业务上应改用封禁（`user.status = 'banned'`）。
   */
  @Index('uq_account_user', { unique: true })
  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Index('uq_account_system', { unique: true })
  @Column({ name: 'system_code', type: 'varchar', length: 32, nullable: true })
  systemCode: SystemCode | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
