import {
  Check,
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 余额 —— `asset_lot` 的**聚合缓存**，供热路径读余额与条件原子扣减。
 *
 * 因为没有 `MINT` 账户，所有账户（含 `FEE`/`ESCROW`）都非负，
 * CHECK 可以无例外地统一施加。
 *
 * 只承载 `currency` 与 `stackable`；`unique` 类资产的持有关系在 `item_instance`。
 */
@Entity('asset_balance')
@Check('ck_balance_non_negative', `"available" >= 0 AND "frozen" >= 0`)
export class AssetBalance {
  @PrimaryColumn({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @PrimaryColumn({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  @Column({ type: 'bigint', default: 0 })
  available: string;

  /** 挂单/出价锁定的部分。仍属本账户，但不可动用 */
  @Column({ type: 'bigint', default: 0 })
  frozen: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
