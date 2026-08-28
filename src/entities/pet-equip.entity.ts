import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Pet } from './pet.entity';

/**
 * 宠物当前穿戴的换装（每个 pet 每个 slot 至多一件）。
 * 仅影响外观，不影响属性（赛跑公平）。
 */
@Entity('pet_equip')
@Index('uq_pet_equip_pet_slot', ['petId', 'slot'], { unique: true })
export class PetEquip {
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

  @Column({ name: 'pet_id', type: 'bigint' })
  petId: string;

  @ManyToOne(() => Pet)
  @JoinColumn({ name: 'pet_id' })
  pet?: Pet;

  @Column({ type: 'varchar', length: 24 })
  slot: string;

  /**
   * 穿戴的资产 code（`asset_def.code`）。
   *
   * 刻意按 code 而非 `item_instance.id` 引用：交易上线后玩家可能同时持有同款皮肤的
   * 两个实例（例如自己买的和买来的限量编号款），但穿在身上的外观完全一样。
   * 按实例引用会让「卖掉其中一件」不得不去修穿戴记录，而按 code 只需校验「还持有至少一件」。
   */
  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
