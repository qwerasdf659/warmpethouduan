import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AdminRole } from './admin-role.entity';

/**
 * 后台管理员账号（与玩家 user 表完全隔离）。
 * passwordHash 存 scrypt 派生格式 `scrypt$N$saltHex$hashHex`，绝不存明文。
 * status: 'active' 正常 | 'disabled' 停用（停用后登录/鉴权一律拒绝）。
 * 管理员 —(多对多)— 角色，权限由角色聚合而来。
 */
@Entity('admin_user')
export class AdminUser {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_admin_user_username', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  username: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ name: 'display_name', type: 'varchar', length: 64, nullable: true })
  displayName: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'disabled';

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @ManyToMany(() => AdminRole)
  @JoinTable({
    name: 'admin_user_role',
    joinColumn: { name: 'admin_user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: AdminRole[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
