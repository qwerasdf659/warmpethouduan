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
 * 一次抽取的产出。
 *
 * **只有物品，没有币**（决策 D1）：`game_coin` 是交易媒介因此必须 `tradable`，
 * 而可交易 + 随机产出会被 `ck_asset_no_trade_gacha` 拦住 —— 那正是「投入→随机
 * →可变现」的开箱模式。冲突的解法是让扭蛋只产出道具与消耗品。
 */
export interface GachaPrize {
  entryKey: string;
  name: string;
  /** 产出的 `asset_def.code` */
  assetCode: string;
  qty: number;
  /** true = 稀有档（触发保底计数重置），供前端做特效分级 */
  rare: boolean;
  /** true = 抽到的是重复且不可交易的收藏品，已折算成补偿道具（见 GachaService） */
  converted: boolean;
}

/**
 * 扭蛋抽取记录。**存在的唯一理由是幂等**。
 *
 * 抽奖是随机的，重试不能重掷 —— 否则「扣一次钱、抽两次奖」或者玩家反复重发
 * 直到抽出好东西。`(user_id, biz_id)` 唯一，重复提交直接回放这一行的 `prizes`。
 *
 * 只靠 `IdempotencyInterceptor`（Redis 24h）不够：Redis 是可丢的，
 * 而扣费走的是经济域的持久幂等，两者一旦不同步就会出现「钱扣了、奖重抽」。
 */
@Entity('gacha_draw')
@Index('uq_gacha_draw_user_biz', ['userId', 'bizId'], { unique: true })
@Index('idx_gacha_draw_user_id', ['userId', 'id'])
export class GachaDraw {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'pool_key', type: 'varchar', length: 48 })
  poolKey: string;

  @Column({ name: 'biz_id', type: 'varchar', length: 128 })
  bizId: string;

  /** 抽取次数（1 或 10 连） */
  @Column({ type: 'int' })
  times: number;

  /** 实际花费（含连抽折扣后的价格） */
  @Column({ type: 'int' })
  cost: number;

  /** 本次抽奖扣费的货币资产 code。 */
  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  @Column({ type: 'jsonb' })
  prizes: GachaPrize[];

  /**
   * 产出是否已兑现（物品已进背包）。
   *
   * 存在的意义是把「已掷出什么」和「是否发到手」分开：先落 `prizes` 再发货，
   * 中途崩了重试就**照原样补发**，而不是重新掷一次。
   * 重掷才是真漏洞 —— 扣费是幂等的，重掷等于同一笔钱能反复换结果。
   */
  @Column({ type: 'boolean', default: false })
  delivered: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
