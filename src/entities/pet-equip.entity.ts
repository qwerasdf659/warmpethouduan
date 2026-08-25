import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
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

  @Column({ name: 'pet_id', type: 'bigint' })
  petId: string;

  @ManyToOne(() => Pet)
  @JoinColumn({ name: 'pet_id' })
  pet?: Pet;

  @Column({ type: 'varchar', length: 24 })
  slot: string;

  @Column({ name: 'item_def_id', type: 'bigint' })
  itemDefId: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
