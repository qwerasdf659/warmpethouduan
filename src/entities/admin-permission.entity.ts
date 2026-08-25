import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 后台权限点。code 是唯一业务标识（如 'player:read'、'config:write'），
 * 前后端一致引用；group 仅用于后台按模块分组展示。
 * bigint 主键在 pg 下以 string 返回，业务层按 string 处理。
 */
@Entity('admin_permission')
export class AdminPermission {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_admin_permission_code', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'group_name', type: 'varchar', length: 64, nullable: true })
  group: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
