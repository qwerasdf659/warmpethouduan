/**
 * item_def 初始播种数据（幂等：按 key upsert，不删除已存在项）。
 * 运营后续可在后台增删改；此处只保证首次启动有可用商品。
 */
export interface SeedItem {
  key: string;
  type: 'skin' | 'accessory' | 'furniture';
  name: string;
  slot: string | null;
  price: number;
  pool: 'game' | 'marketing';
  comfort: number;
  sortOrder: number;
  meta?: Record<string, unknown>;
}

export const SEED_ITEMS: SeedItem[] = [
  // 皮肤（body 槽）
  {
    key: 'skin_default',
    type: 'skin',
    name: '原色',
    slot: 'body',
    price: 0,
    pool: 'game',
    comfort: 0,
    sortOrder: 1,
  },
  {
    key: 'skin_snow',
    type: 'skin',
    name: '雪白',
    slot: 'body',
    price: 200,
    pool: 'game',
    comfort: 0,
    sortOrder: 2,
  },
  {
    key: 'skin_tiger',
    type: 'skin',
    name: '虎纹',
    slot: 'body',
    price: 500,
    pool: 'game',
    comfort: 0,
    sortOrder: 3,
  },
  // 配饰（hat 槽）
  {
    key: 'acc_cap',
    type: 'accessory',
    name: '棒球帽',
    slot: 'hat',
    price: 150,
    pool: 'game',
    comfort: 0,
    sortOrder: 10,
  },
  {
    key: 'acc_crown',
    type: 'accessory',
    name: '小皇冠',
    slot: 'hat',
    price: 800,
    pool: 'game',
    comfort: 0,
    sortOrder: 11,
  },
  {
    key: 'acc_scarf',
    type: 'accessory',
    name: '围巾',
    slot: 'neck',
    price: 300,
    pool: 'game',
    comfort: 0,
    sortOrder: 12,
  },
  // 家具（furniture）
  {
    key: 'furn_mat',
    type: 'furniture',
    name: '暖垫',
    slot: null,
    price: 100,
    pool: 'game',
    comfort: 8,
    sortOrder: 20,
  },
  {
    key: 'furn_sofa',
    type: 'furniture',
    name: '沙发',
    slot: null,
    price: 400,
    pool: 'game',
    comfort: 15,
    sortOrder: 21,
  },
  {
    key: 'furn_lamp',
    type: 'furniture',
    name: '落地灯',
    slot: null,
    price: 250,
    pool: 'game',
    comfort: 10,
    sortOrder: 22,
  },
  {
    key: 'furn_tree',
    type: 'furniture',
    name: '猫爬架',
    slot: null,
    price: 600,
    pool: 'game',
    comfort: 20,
    sortOrder: 23,
  },
];
