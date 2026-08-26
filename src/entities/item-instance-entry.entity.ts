import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 唯一物品的转移分录。**真双录**：转移必须成对（转出 −1、转入 +1），
 * 铸造只有一条 +1。
 *
 * 于是「某个实例同时属于两个人」或「凭空多出一件」在结构上不可能：
 * 对账不变量 5 校验每个实例 `SUM(delta) == 1`。
 */
@Entity('item_instance_entry')
@Check('ck_instance_entry_delta', `"delta" IN (-1, 1)`)
@Index('uq_instance_entry', ['instanceId', 'txnId', 'accountId'], {
  unique: true,
})
export class ItemInstanceEntry {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'txn_id', type: 'bigint' })
  txnId: string;

  @Index('idx_instance_entry_instance')
  @Column({ name: 'instance_id', type: 'bigint' })
  instanceId: string;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ type: 'smallint' })
  delta: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
