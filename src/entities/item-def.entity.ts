import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 物品定义（配置表）。统一承载**换装**（skin/accessory）与**家具**（furniture）：
 * 用 type 区分，减少表数量。装扮**不加属性**（仅外观），家具贡献 comfort（家园舒适度）。
 * 运营可在后台 CRUD；应用启动会幂等播种一批初始物品。
 */
@Entity('item_def')
export class ItemDef {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  /** 稳定业务键，前端与其它表引用它（如 'skin_tiger'、'furn_sofa'） */
  @Index('uq_item_def_key', { unique: true })
  @Column({ type: 'varchar', length: 48 })
  key: string;

  /**
   * skin 皮肤 | accessory 配饰 | furniture 家具 | consumable 消耗品
   *
   * 前三类是**一次性买断的收藏品**（计入图鉴收集口径），consumable 是
   * **可重复消耗**的（用掉就没了，不计图鉴），两者的经济学作用完全不同。
   */
  @Column({ type: 'varchar', length: 16 })
  type: 'skin' | 'accessory' | 'furniture' | 'consumable';

  @Column({ type: 'varchar', length: 48 })
  name: string;

  /** 换装槽位（skin=body、accessory=hat/neck…）；家具为 null */
  @Column({ type: 'varchar', length: 24, nullable: true })
  slot: string | null;

  /** 售价（0 为免费/不可售） */
  @Column({ type: 'int', default: 0 })
  price: number;

  /** 计价与扣费的积分池 */
  @Column({ type: 'varchar', length: 16, default: 'game' })
  pool: 'game' | 'marketing';

  /** 家具舒适度贡献（换装类为 0） */
  @Column({ type: 'int', default: 0 })
  comfort: number;

  /** 家具占格宽（家园网格，单位格；换装类恒为 1 且不参与摆放） */
  @Column({ name: 'grid_w', type: 'int', default: 1 })
  gridW: number;

  /** 家具占格高 */
  @Column({ name: 'grid_h', type: 'int', default: 1 })
  gridH: number;

  /** 扩展字段（贴图、颜色、尺寸等），前端渲染用 */
  @Column({ type: 'jsonb', default: {} })
  meta: Record<string, unknown>;

  /** 下架后不可购买、不在商店展示（已拥有仍可用） */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
