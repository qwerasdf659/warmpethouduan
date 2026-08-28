import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PromoCode } from './promo-code.entity';
import { User } from './user.entity';

/**
 * 兑换码核销记录。只追加，不修改。
 *
 * `(code_id, user_id)` 唯一索引是「每码每人一次」的**唯一**依据：
 * 并发下两个请求同时通过 COUNT 检查是必然会发生的，靠唯一索引让其中一个
 * 插入失败才是可靠做法。
 *
 * `asset_code` / `amount` 是**下单时快照**：码的面额后来被运营改了，也要能说清当时发了多少。
 */
@Entity('promo_redemption')
@Index('uq_promo_redemption_code_user', ['codeId', 'userId'], { unique: true })
@Index('idx_promo_redemption_user_id', ['userId', 'id'])
export class PromoRedemption {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'code_id', type: 'bigint' })
  codeId: string;

  @ManyToOne(() => PromoCode)
  @JoinColumn({ name: 'code_id' })
  promoCode?: PromoCode;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** 核销时的码明文快照（码行被删也能追溯） */
  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** 核销时的货币资产 code 快照。 */
  @Column({ name: 'asset_code', type: 'varchar', length: 48 })
  assetCode: string;

  @Column({ type: 'int' })
  amount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
