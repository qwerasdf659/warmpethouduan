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
import { AdminMenu } from './admin-menu.entity';

/**
 * 后台角色。code 唯一（如 'super_admin'、'ops'、'viewer'）。
 * isSystem=true 的内置角色禁止删除/改 code（尤其 super_admin：拥有全部权限）。
 * 角色 —(多对多)— 权限 / 菜单，中间表列名显式 snake_case。
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

  @ManyToMany(() => AdminMenu)
  @JoinTable({
    name: 'admin_role_menu',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'menu_id', referencedColumnName: 'id' },
  })
  menus: AdminMenu[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
