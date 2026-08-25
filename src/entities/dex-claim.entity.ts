import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * 图鉴已领取记录。图鉴条目本身在配置中定义（dex.config.ts），
 * 解锁进度由玩家实际养成实时推导；本表只记「某条目奖励已领取」。
 */
@Entity('dex_claim')
@Index('uq_dex_claim_user_entry', ['userId', 'entryKey'], { unique: true })
export class DexClaim {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'entry_key', type: 'varchar', length: 48 })
  entryKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
