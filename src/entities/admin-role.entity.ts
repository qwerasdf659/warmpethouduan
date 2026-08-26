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
import { AdminPermission } from './admin-permission.entity';

/**
 * 后台角色。code 唯一（如 'super_admin'、'ops'、'viewer'）。
 * isSystem=true 的内置角色禁止删除/改 code（尤其 super_admin：拥有全部权限）。
 * 角色 —(多对多)— 权限，中间表列名显式 snake_case。
 *
 * 菜单可见性**不在这里**：由 `admin_menu.permission_code` 与角色权限集求交得出
 * （见 AdminAccessService.resolveMenus）。菜单授权只有这一套真相源。
 */
@Entity('admin_role')
export class AdminRole {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('uq_admin_role_code', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @ManyToMany(() => AdminPermission)
  @JoinTable({
    name: 'admin_role_permission',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: AdminPermission[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
