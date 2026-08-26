import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 凭证类型。校验强度按类型区分，见架构设计 §2.2：
 *  - `issue` / `burn`：单边，**不要求平衡**（发行与销毁本就是凭空产生与消失）
 *  - `transfer`：≥2 条分录，按资产求和必须为 0
 *  - `freeze`：可用余额与冻结余额之间搬移，`delta + frozenDelta` 守恒
 *  - `reversal`：冲正，校验强度同原凭证
 */
export type TxnKind = 'issue' | 'burn' | 'transfer' | 'freeze' | 'reversal';

/**
 * 凭证头 —— **全局幂等的唯一权威**。
 *
 * 旧模型把幂等键分散在 `ledger` / `redeem_order` / `gacha_draw` / `promo_redemption`
 * 四张表上，每加一个业务都要记得配一套。收敛到这里之后，一次操作 N 条分录整体原子、
 * 整体幂等，新增业务不可能漏配。
 *
 * ⚠ `biz_id` 全局唯一 ⇒ **必须自带用户区分**。旧 `ledger` 的幂等键是
 * `(user_id, biz_id, pool)`，带 `user_id` 是为了防不同玩家撞同一个客户端 UUID。
 * 提到凭证头后不再有 `user_id` 参与，因此前缀由 `LedgerService` 内部强制拼接，
 * 调用方无法绕过（见 `LedgerService.buildBizId`）。
 */
@Entity('asset_txn')
@Check(
  'ck_asset_txn_kind',
  `"kind" IN ('issue','burn','transfer','freeze','reversal')`,
)
export class AssetTxn {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  /** `varchar(160)` 是为强制前缀留的余量 */
  @Index('uq_asset_txn_biz_id', { unique: true })
  @Column({ name: 'biz_id', type: 'varchar', length: 160 })
  bizId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: TxnKind;

  @Column({ type: 'varchar', length: 32 })
  reason: string;

  @Column({ name: 'ref_type', type: 'varchar', length: 32, nullable: true })
  refType: string | null;

  @Column({ name: 'ref_id', type: 'varchar', length: 64, nullable: true })
  refId: string | null;

  /** 冲正指向的原凭证 */
  @Column({ name: 'reversal_of', type: 'bigint', nullable: true })
  reversalOf: string | null;

  @Index('idx_asset_txn_created')
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
