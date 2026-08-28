import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 兑换码（营销积分的玩家侧入口）。
 *
 * 一行 = 一个码。两种运营形态用同一张表表达，区别只在 `max_uses`：
 *  - **一码一用**（线下物料印码）：批量生成 N 行，每行 `max_uses = 1`；
 *  - **一码多用**（异业合作发券，如 `SUMMER2026`）：生成 1 行，`max_uses = 1000`。
 *
 * **刻意不做「每码每人可用多次」**：每人一次由 `promo_redemption` 的
 * `(code_id, user_id)` 唯一索引在数据库层保证，不靠 COUNT 判断——后者在并发下会漏。
 * 真要给同一玩家发两份，运营多发一个码即可，比放开限制安全得多。
 */
@Entity('promo_code')
@Check('ck_promo_code_amount', `"amount" > 0`)
@Check('ck_promo_code_asset', `"asset_code" IN ('game_coin','marketing_point')`)
@Check('ck_promo_code_uses', `"max_uses" > 0 AND "used_count" >= 0`)
@Index('idx_promo_code_batch', ['batch'])
export class PromoCode {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  /**
   * 兑换码明文，**统一大写**且去掉分隔符后入库（`normalizeCode`）。
   * 玩家输入 `abcd-efgh` 与 `ABCDEFGH` 应命中同一行，所以不能直接存原样。
   */
  @Index('uq_promo_code_code', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** 批次名（如 `2026暑期门店`），供后台归类与统计 */
  @Column({ type: 'varchar', length: 48 })
  batch: string;

  /** 该批码发放的货币资产 code（`game_coin` / `marketing_point`）。 */
  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  /** 面额（单位为 `asset_code` 对应货币的最小单位） */
  @Column({ type: 'int' })
  amount: number;

  @Column({ name: 'max_uses', type: 'int', default: 1 })
  maxUses: number;

  /** 已核销次数。由单语句条件自增维护，不重算 */
  @Column({ name: 'used_count', type: 'int', default: 0 })
  usedCount: number;

  /** 过期时间；null = 永不过期 */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  /** 停用（作废整批/单码时用；已核销记录不受影响） */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
