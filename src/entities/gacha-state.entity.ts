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

/**
 * 扭蛋保底进度（每人每池一行）。
 *
 * **刻意落表而不是放 Redis**：保底计数是玩家花了真金白银（游戏币）攒出来的，
 * Redis 一次 flush 就把它清零，等于把玩家的投入抹掉 —— 这类「攒进度」数据
 * 和每日任务进度（隔天即失效，丢了无所谓）性质完全不同。
 */
@Entity('gacha_state')
@Index('uq_gacha_state_user_pool', ['userId', 'poolKey'], { unique: true })
export class GachaState {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'pool_key', type: 'varchar', length: 48 })
  poolKey: string;

  /** 距上次出稀有的抽数。抽出稀有或触发保底时归零 */
  @Column({ name: 'pity', type: 'int', default: 0 })
  pity: number;

  /** 累计抽数（只增，供运营看投放深度） */
  @Column({ name: 'total_draws', type: 'int', default: 0 })
  totalDraws: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
