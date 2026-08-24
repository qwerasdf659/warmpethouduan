import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 账户表。以 unionid 为主身份（若已绑微信开放平台），否则退化用 openid。
 * 注意：bigint 主键在 pg 驱动下以字符串返回，业务层统一按 string 处理。
 */
@Entity('user')
export class User {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_user_unionid', { unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  unionid: string | null;

  @Index('uq_user_openid', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  openid: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
