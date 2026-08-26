import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 分录 —— 追加不可改，**唯一审计真相**。
 *
 * ⚠ 本实体只映射分区父表做**只读查询**（`find` / `findAndCount` 正常工作）。
 * 建表由 raw SQL 迁移负责：物理表是 `PARTITION BY RANGE (created_at)` 按月分区，
 * TypeORM 无法生成分区 DDL。写入一律走 `LedgerService` 的原生 SQL。
 *
 * ⚠⚠ `synchronize: false` **必须保留**（全部账本与市场实体同此）。
 * 少了它，`migration:generate` 会把库里那些它表达不了的东西全判成「多余」，
 * 生成一个 DROP 掉分区序列、`created_at` 默认值、全部外键与部分索引
 * （`uq_lot_bucket` 的 `NULLS NOT DISTINCT`、`uq_instance_serial` 等带 WHERE 的索引、
 * `idx_asset_def_item_type` 的表达式索引）的迁移 —— 跑下去账本会直接写不进去。
 * 这不是理论风险：加这个选项之前实测生成的迁移正是如此。
 * 账本表的结构变更一律手写 raw SQL 迁移。
 *
 * PK 是 `(id, created_at)` 而不是 `id`：PG 规定分区表的 PK 与 UNIQUE 必须包含分区键。
 * 分录上因此没有唯一约束 —— 也不需要，幂等已经在 `asset_txn.biz_id`（非分区表，
 * 可全局唯一），凭证插入成功才写分录，同一事务内保证一一对应。
 *
 * 归档只允许 `DETACH PARTITION` + 转储到对象存储，**禁止 DELETE**：物理删除会
 * 摧毁回档能力，而游戏出重大事故（数值配错、外挂刷币）时回档是必需手段。
 */
@Entity({ name: 'asset_entry', synchronize: false })
@Check('ck_entry_nonzero', `"delta" <> 0 OR "frozen_delta" <> 0`)
@Index('idx_entry_account', ['accountId', 'assetCode', 'createdAt'])
export class AssetEntry {
  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Index('idx_entry_txn')
  @Column({ name: 'txn_id', type: 'bigint' })
  txnId: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  /** 可用余额变动 */
  @Column({ type: 'bigint', default: 0 })
  delta: string;

  /** 冻结余额变动 */
  @Column({ name: 'frozen_delta', type: 'bigint', default: 0 })
  frozenDelta: string;

  @Column({ name: 'balance_after', type: 'bigint' })
  balanceAfter: string;

  @Column({ name: 'frozen_after', type: 'bigint' })
  frozenAfter: string;

  @PrimaryColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
