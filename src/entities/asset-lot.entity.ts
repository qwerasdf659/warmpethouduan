import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 批次（lot）—— 余额的**分桶实现**，承载 FIFO 消耗与过期批处理。
 *
 * 为什么必须一开始就建：批次归属信息**无法事后补**。上线跑几个月后，玩家手上的
 * 余额是哪一批发的、该哪天过期，这个信息永久丢失，只能全部当作永不过期。
 *
 * 关键设计是**按到期日归并**，而不是每次发行建一个批次。这让「不启用过期」的
 * 成本归零：`game_coin` 配 `expireDays = NULL`，于是每玩家恒为 1 行，
 * 读写代价与一张普通余额表无异。
 *
 * 唯一索引 `uq_lot_bucket` 用 PG15+ 的 `NULLS NOT DISTINCT`（迁移里建），
 * 使 `expires_at IS NULL` 也受唯一约束覆盖 —— 否则 `NULL` 互不相等，
 * 每次发行都会新建一行，归并设计整个塌掉。
 *
 * **分录不细分到 lot**：一次消耗可能横跨多个批次，但分录仍只记「该账户该资产净变动
 * 多少」。玩家关心「我的币少了多少」，财务关心「发行与兑付总量」，两者都不需要
 * 批次级溯源；细分会让分录数量爆炸且对账复杂度翻倍。批次的分摊结果由本表自身状态
 * 承载，一致性由对账不变量 9 校验。
 */
@Entity({ name: 'asset_lot', synchronize: false })
@Check('ck_lot_non_negative', `"remaining" >= 0 AND "frozen" >= 0`)
@Check('ck_lot_within_issued', `"remaining" + "frozen" <= "issued_total"`)
export class AssetLot {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  /** 该批次剩余可用 */
  @Column({ type: 'bigint', default: 0 })
  remaining: string;

  /** 该批次被冻结的部分 */
  @Column({ type: 'bigint', default: 0 })
  frozen: string;

  /** 累计发行（只增，审计用） */
  @Column({ name: 'issued_total', type: 'bigint', default: 0 })
  issuedTotal: string;

  /** NULL = 永不过期 */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
