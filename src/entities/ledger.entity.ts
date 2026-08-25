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

/**
 * 积分流水（**只追加、不可改、不可删**，故无 updated_at）。
 * 单边流水账本：每行 = 「某玩家某池的一次变动」，不做银行式复式双录
 *（单机内闭环、无对手方结算，复式属过度设计）。
 *
 * 幂等以 (user_id, biz_id, pool) 唯一索引为**持久权威**——Redis 幂等缓存只有 24h，
 * 钱相关不能只靠缓存。粒度选到 pool 而非仅 biz_id 是为了：
 *  1) 带上 user_id，避免不同玩家撞同一个 bizId 时误判重复（会串账/泄露他人账目）；
 *  2) 允许一次操作最多各动一次两个池。
 */
@Entity('ledger')
@Index('uq_ledger_user_biz_pool', ['userId', 'bizId', 'pool'], { unique: true })
// 服务于「按玩家倒序翻流水」这一主查询（id 为 BIGSERIAL，与时间同序）。
// 后台若要做全局按日期范围的对账查询，届时再单独加 created_at 索引，不预先付写入代价。
@Index('idx_ledger_user_id_id', ['userId', 'id'])
@Check('ck_ledger_pool', `"pool" IN ('game','marketing')`)
@Check('ck_ledger_delta_nonzero', '"delta" <> 0')
export class Ledger {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  // FK 为 NO ACTION：有资金流水的玩家不允许被硬删（业务上应改用封禁），
  // 同时兜住「往不存在的 userId 记账」这类 bug。
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** 'game' | 'marketing' */
  @Column({ type: 'varchar', length: 16 })
  pool: string;

  /** 变动量，正数为发放、负数为扣减；禁止为 0 */
  @Column({ type: 'bigint' })
  delta: string;

  /** 本次变动后该池余额快照，供对账与逐笔回溯 */
  @Column({ name: 'balance_after', type: 'bigint' })
  balanceAfter: string;

  /** 客户端生成的业务操作 id（幂等键） */
  @Column({ name: 'biz_id', type: 'varchar', length: 128 })
  bizId: string;

  /** 变动原因，如 interact/offline/race/exchange/admin_grant */
  @Column({ type: 'varchar', length: 32 })
  reason: string;

  /** 关联业务对象 id（关卡/商品/订单等），便于反查 */
  @Column({ name: 'ref_id', type: 'varchar', length: 64, nullable: true })
  refId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
