import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** `listed`/`escrowed` 期间物品在 ESCROW 账户名下，玩家不可穿戴或摆放。 */
export type InstanceState = 'held' | 'listed' | 'escrowed';

/**
 * 唯一物品实例。皮肤 / 配饰 / 限定收藏品走这里，家具与消耗品走 `asset_balance`。
 *
 * **这解决了旧模型 `item_def.type` 混三种语义的问题**：旧 `item_owned.qty` 对皮肤
 * 恒为 1（无意义）、对家具是件数、对消耗品是余量，每个读它的地方都要知道该怎么
 * 解释。现在身份语义与数量语义分表，不再有约定。
 *
 * 唯一物品走**真双录**（`item_instance_entry` 转移必须成对 ±1），
 * 所以「物品凭空产生」结构性不可能。`ownerAccountId` 是从分录派生的缓存，
 * 由对账不变量 6 校验漂移。
 */
@Entity('item_instance')
@Check('ck_instance_state', `"state" IN ('held','listed','escrowed')`)
@Index('idx_instance_owner', ['ownerAccountId', 'assetCode'])
export class ItemInstance {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  @Column({ name: 'owner_account_id', type: 'bigint' })
  ownerAccountId: string;

  @Column({ type: 'varchar', length: 16, default: 'held' })
  state: InstanceState;

  /**
   * 限量编号（「第 7/100 件」）。由 `asset_def` 的原子分配语句产生，
   * `uq_instance_serial` 保证同一 `assetCode` 下不重复。
   *
   * 编号本身产生收藏溢价，而这只有在实例化之后才可能 —— 事后无法补，
   * 因为无法确定历史上谁先获得。
   */
  @Column({ type: 'int', nullable: true })
  serial: number | null;

  @CreateDateColumn({ name: 'acquired_at', type: 'timestamptz' })
  acquiredAt: Date;

  /** 冷却期到期时间（`acquiredAt + assetDef.tradeCooldownHours`），防盗号即刻套现 */
  @Column({ name: 'tradable_after', type: 'timestamptz', nullable: true })
  tradableAfter: Date | null;

  @Column({ name: 'minted_txn_id', type: 'bigint' })
  mintedTxnId: string;
}
