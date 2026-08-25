import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 后台操作审计日志。所有 /admin/* 写操作（及标注 @Audit 的接口）落一条。
 * adminUsername 冗余快照，便于管理员被删后仍可追溯是谁做的。
 * requestBody 已脱敏（剔除 password 等敏感字段）。软失败：写日志出错不影响主链路。
 */
@Entity('admin_audit_log')
export class AdminAuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('idx_admin_audit_admin_user_id')
  @Column({ name: 'admin_user_id', type: 'bigint', nullable: true })
  adminUserId: string | null;

  @Column({
    name: 'admin_username',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  adminUsername: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  action: string | null;

  @Column({ type: 'varchar', length: 8 })
  method: string;

  @Column({ type: 'varchar', length: 255 })
  path: string;

  @Column({ name: 'target_type', type: 'varchar', length: 64, nullable: true })
  targetType: string | null;

  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @Column({ name: 'biz_id', type: 'varchar', length: 128, nullable: true })
  bizId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  /** 脱敏后的请求体；列可空，写入 null 表示无 body。 */
  @Column({ name: 'request_body', type: 'jsonb', nullable: true })
  requestBody: unknown;

  @Column({ name: 'status_code', type: 'int' })
  statusCode: number;

  @Column({ type: 'boolean' })
  success: boolean;

  @Column({
    name: 'error_message',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  errorMessage: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Index('idx_admin_audit_created_at')
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
