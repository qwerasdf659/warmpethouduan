import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * 宠物表。M1 假设一人一宠。
 * last_seen_at 存服务端时间（timestamptz，UTC），是所有衰减/结算的基准。
 */
@Entity('pet')
export class Pet {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_pet_user_id', { unique: true })
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'int', default: 100 })
  hunger: number;

  @Column({ type: 'int', default: 80 })
  mood: number;

  @Column({ type: 'int', default: 100 })
  cleanliness: number;

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ type: 'int', default: 0 })
  exp: number;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
