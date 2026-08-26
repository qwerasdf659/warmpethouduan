/**
 * item_def 初始播种数据（幂等：按 key upsert，不删除已存在项）。
 * 运营后续可在后台增删改；此处只保证首次启动有可用商品。
 *
 * ⚠ **播种只补新 key，不改已存在行的价格**。因此调价必须同时写迁移
 * （见 `ItemRepriceAndConsumables` 迁移），否则老库仍是旧价。
 *
 * 定价口径（2026-08-26 重标定）：
 * 保守日收入约 900 游戏币（互动上限 500 + 签到 100 + 每日任务 85 + 离线 80 + 广告 150）。
 * 收藏品目录合计约 18700，即**全买断约需三周**，而不是此前的 3~4 天。
 * 三周之后靠**可重复消耗**兜住产出：扭蛋（`gacha.pools`）、消耗品、赛跑门票、
 * 加速与体力恢复。收藏品是有限的，长期 sink 只能靠可重复项，这是定价的核心前提。
 */
export interface SeedItem {
  key: string;
  type: 'skin' | 'accessory' | 'furniture' | 'consumable';
  name: string;
  /**
   * 穿戴槽位：皮肤 `body`，配饰 `hat`/`neck`/`bg`（背景），家具与消耗品为 null。
   * 背景走 accessory 类型是有意的：它是**穿在宠物身上的外观**，属于换装子系统，
   * 而 `type` 的职责是分「换装 or 家园 or 消耗」，不是分外观品类。
   */
  slot: string | null;
  price: number;
  pool: 'game' | 'marketing';
  comfort: number;
  /** 家具占格宽高（换装/消耗品省略，默认 1×1 且不参与摆放） */
  gridW?: number;
  gridH?: number;
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
    price: 400,
    pool: 'game',
    comfort: 0,
    sortOrder: 2,
  },
  {
    key: 'skin_tiger',
    type: 'skin',
    name: '虎纹',
    slot: 'body',
    price: 900,
    pool: 'game',
    comfort: 0,
    sortOrder: 3,
  },
  {
    key: 'skin_calico',
    type: 'skin',
    name: '三花',
    slot: 'body',
    price: 1400,
    pool: 'game',
    comfort: 0,
    sortOrder: 4,
  },
  {
    key: 'skin_shadow',
    type: 'skin',
    name: '玄影',
    slot: 'body',
    price: 2200,
    pool: 'game',
    comfort: 0,
    sortOrder: 5,
  },
  // 配饰（hat 槽）
  {
    key: 'acc_cap',
    type: 'accessory',
    name: '棒球帽',
    slot: 'hat',
    price: 300,
    pool: 'game',
    comfort: 0,
    sortOrder: 10,
  },
  {
    key: 'acc_bow',
    type: 'accessory',
    name: '蝴蝶结',
    slot: 'hat',
    price: 450,
    pool: 'game',
    comfort: 0,
    sortOrder: 11,
  },
  {
    key: 'acc_glasses',
    type: 'accessory',
    name: '墨镜',
    slot: 'hat',
    price: 700,
    pool: 'game',
    comfort: 0,
    sortOrder: 12,
  },
  {
    key: 'acc_crown',
    type: 'accessory',
    name: '小皇冠',
    slot: 'hat',
    price: 1600,
    pool: 'game',
    comfort: 0,
    sortOrder: 13,
  },
  // 配饰（neck 槽）
  {
    key: 'acc_bell',
    type: 'accessory',
    name: '铃铛',
    slot: 'neck',
    price: 350,
    pool: 'game',
    comfort: 0,
    sortOrder: 20,
  },
  {
    key: 'acc_bandana',
    type: 'accessory',
    name: '领巾',
    slot: 'neck',
    price: 500,
    pool: 'game',
    comfort: 0,
    sortOrder: 21,
  },
  {
    key: 'acc_scarf',
    type: 'accessory',
    name: '围巾',
    slot: 'neck',
    price: 600,
    pool: 'game',
    comfort: 0,
    sortOrder: 22,
  },
  // 背景（bg 槽，走 accessory 类型）
  {
    key: 'bg_room',
    type: 'accessory',
    name: '暖阳小屋',
    slot: 'bg',
    price: 0,
    pool: 'game',
    comfort: 0,
    sortOrder: 30,
  },
  {
    key: 'bg_garden',
    type: 'accessory',
    name: '午后花园',
    slot: 'bg',
    price: 800,
    pool: 'game',
    comfort: 0,
    sortOrder: 31,
  },
  {
    key: 'bg_beach',
    type: 'accessory',
    name: '海边夕照',
    slot: 'bg',
    price: 1200,
    pool: 'game',
    comfort: 0,
    sortOrder: 32,
  },
  {
    key: 'bg_starry',
    type: 'accessory',
    name: '星夜露台',
    slot: 'bg',
    price: 1800,
    pool: 'game',
    comfort: 0,
    sortOrder: 33,
  },
  // 家具（furniture）。占格尺寸按体积给，6×6 房间共 36 格，全套摆下约占 15 格
  {
    key: 'furn_bowl',
    type: 'furniture',
    name: '食盆',
    slot: null,
    price: 200,
    pool: 'game',
    comfort: 5,
    gridW: 1,
    gridH: 1,
    sortOrder: 40,
  },
  {
    key: 'furn_mat',
    type: 'furniture',
    name: '暖垫',
    slot: null,
    price: 250,
    pool: 'game',
    comfort: 8,
    gridW: 2,
    gridH: 2,
    sortOrder: 41,
  },
  {
    key: 'furn_lamp',
    type: 'furniture',
    name: '落地灯',
    slot: null,
    price: 550,
    pool: 'game',
    comfort: 10,
    gridW: 1,
    gridH: 1,
    sortOrder: 42,
  },
  {
    key: 'furn_rug',
    type: 'furniture',
    name: '圆形地毯',
    slot: null,
    price: 700,
    pool: 'game',
    comfort: 12,
    gridW: 2,
    gridH: 2,
    sortOrder: 43,
  },
  {
    key: 'furn_sofa',
    type: 'furniture',
    name: '沙发',
    slot: null,
    price: 900,
    pool: 'game',
    comfort: 15,
    gridW: 2,
    gridH: 1,
    sortOrder: 44,
  },
  {
    key: 'furn_tree',
    type: 'furniture',
    name: '猫爬架',
    slot: null,
    price: 1300,
    pool: 'game',
    comfort: 20,
    gridW: 1,
    gridH: 2,
    sortOrder: 45,
  },
  {
    key: 'furn_window',
    type: 'furniture',
    name: '落地窗',
    slot: null,
    price: 1600,
    pool: 'game',
    comfort: 18,
    gridW: 1,
    gridH: 2,
    sortOrder: 46,
  },
  // 消耗品（consumable）。效果在配置中心 `items.consumables`，此处只管目录与价格。
  // 单价刻意做低：它们是「日常小额、可无限重复」的 sink，靠频次而非单价吸币。
  {
    key: 'cons_toy',
    type: 'consumable',
    name: '玩具球',
    slot: null,
    price: 50,
    pool: 'game',
    comfort: 0,
    sortOrder: 60,
  },
  {
    key: 'cons_snack',
    type: 'consumable',
    name: '宠物零食',
    slot: null,
    price: 60,
    pool: 'game',
    comfort: 0,
    sortOrder: 61,
  },
  {
    key: 'cons_bubble',
    type: 'consumable',
    name: '清洁泡泡',
    slot: null,
    price: 60,
    pool: 'game',
    comfort: 0,
    sortOrder: 62,
  },
  {
    key: 'cons_energy',
    type: 'consumable',
    name: '能量饮',
    slot: null,
    price: 120,
    pool: 'game',
    comfort: 0,
    sortOrder: 63,
  },
  {
    key: 'cons_cake',
    type: 'consumable',
    name: '生日蛋糕',
    slot: null,
    price: 300,
    pool: 'game',
    comfort: 0,
    sortOrder: 64,
  },
];
