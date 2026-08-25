import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 后台菜单/按钮节点（前端 ProLayout 渲染 + 按钮级权限）。
 * type: 'catalog' 目录 | 'menu' 页面 | 'button' 按钮级权限点。
 * permissionCode 关联 admin_permission.code：拥有该权限才可见/可用。
 * parentId 为 null 表示顶级；bigint 主键/外键在 pg 下按 string 处理。
 */
@Entity('admin_menu')
export class AdminMenu {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('idx_admin_menu_parent_id')
  @Column({ name: 'parent_id', type: 'bigint', nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'menu' })
  type: 'catalog' | 'menu' | 'button';

  @Column({ type: 'varchar', length: 255, nullable: true })
  path: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  component: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  icon: string | null;

  @Column({
    name: 'permission_code',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  permissionCode: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', default: true })
  visible: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
