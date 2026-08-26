import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 两件事：收藏品**重标定价**（待办清单 B4-B/C）+ `gacha_draw.delivered` 交付标记。
 *
 * ## 为什么调价必须走迁移
 * `item-seed.ts` 的播种是「按 key upsert，只补新键、不改已存在行」——这是刻意的，
 * 否则运营在后台调过的价格会被下一次重启悄悄推平。代价是**调价改不动老库**：
 * 存量行仍是旧价。所以每次重标定都得配一条迁移，把口径显式写进库里。
 *
 * ## 调价口径（2026-08-26）
 * 保守日收入约 900 游戏币（互动上限 500 + 签到 100 + 每日任务 85 + 离线 80 + 广告 150）。
 * 旧价目合计约 6900，全买断只需 **3~4 天**，之后游戏币彻底失去意义。
 * 新价目合计 18700，全买断约 **三周**。
 *
 * 三周之后靠**可无限重复的消耗**接住产出：扭蛋（`gacha.pools`）、消耗品
 * （`items.consumables`）、赛跑门票、加速与体力恢复。收藏品是有限的，
 * 长期通胀只能靠可重复项压住 —— 这是本次定价的核心前提，改价时别只看单品。
 *
 * ## 已购买的玩家怎么办
 * **不补差价、不退款**。涨价前买到的就是便宜买到的，回溯调整反而会让
 * 「我的余额为什么变了」变成无法解释的事。价目表本身是运营数据，不是承诺。
 *
 * ## delivered 列
 * 抽奖把「掷出了什么」（`prizes`）和「是否发到手」（`delivered`）分开记：
 * 发货中途崩了就按原样补发，而不是重掷。重掷才是真漏洞 —— 扣费是幂等的，
 * 重掷等于同一笔钱能反复换结果。默认 false 对存量行无影响（建表至今无数据）。
 */

/** key → 与 `item-seed.ts` 完全一致的目录字段。改这里必须同步改播种文件。 */
const CATALOG: {
  key: string;
  price: number;
  comfort: number;
  gridW: number;
  gridH: number;
  sortOrder: number;
}[] = [
  // 皮肤
  {
    key: 'skin_default',
    price: 0,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 1,
  },
  {
    key: 'skin_snow',
    price: 400,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 2,
  },
  {
    key: 'skin_tiger',
    price: 900,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 3,
  },
  {
    key: 'skin_calico',
    price: 1400,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 4,
  },
  {
    key: 'skin_shadow',
    price: 2200,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 5,
  },
  // 配饰 hat
  { key: 'acc_cap', price: 300, comfort: 0, gridW: 1, gridH: 1, sortOrder: 10 },
  { key: 'acc_bow', price: 450, comfort: 0, gridW: 1, gridH: 1, sortOrder: 11 },
  {
    key: 'acc_glasses',
    price: 700,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 12,
  },
  {
    key: 'acc_crown',
    price: 1600,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 13,
  },
  // 配饰 neck
  {
    key: 'acc_bell',
    price: 350,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 20,
  },
  {
    key: 'acc_bandana',
    price: 500,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 21,
  },
  {
    key: 'acc_scarf',
    price: 600,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 22,
  },
  // 背景 bg
  { key: 'bg_room', price: 0, comfort: 0, gridW: 1, gridH: 1, sortOrder: 30 },
  {
    key: 'bg_garden',
    price: 800,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 31,
  },
  {
    key: 'bg_beach',
    price: 1200,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 32,
  },
  {
    key: 'bg_starry',
    price: 1800,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 33,
  },
  // 家具
  {
    key: 'furn_bowl',
    price: 200,
    comfort: 5,
    gridW: 1,
    gridH: 1,
    sortOrder: 40,
  },
  {
    key: 'furn_mat',
    price: 250,
    comfort: 8,
    gridW: 2,
    gridH: 2,
    sortOrder: 41,
  },
  {
    key: 'furn_lamp',
    price: 550,
    comfort: 10,
    gridW: 1,
    gridH: 1,
    sortOrder: 42,
  },
  {
    key: 'furn_rug',
    price: 700,
    comfort: 12,
    gridW: 2,
    gridH: 2,
    sortOrder: 43,
  },
  {
    key: 'furn_sofa',
    price: 900,
    comfort: 15,
    gridW: 2,
    gridH: 1,
    sortOrder: 44,
  },
  {
    key: 'furn_tree',
    price: 1300,
    comfort: 20,
    gridW: 1,
    gridH: 2,
    sortOrder: 45,
  },
  {
    key: 'furn_window',
    price: 1600,
    comfort: 18,
    gridW: 1,
    gridH: 2,
    sortOrder: 46,
  },
  // 消耗品：单价刻意做低，靠频次而非单价吸币
  { key: 'cons_toy', price: 50, comfort: 0, gridW: 1, gridH: 1, sortOrder: 60 },
  {
    key: 'cons_snack',
    price: 60,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 61,
  },
  {
    key: 'cons_bubble',
    price: 60,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 62,
  },
  {
    key: 'cons_energy',
    price: 120,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 63,
  },
  {
    key: 'cons_cake',
    price: 300,
    comfort: 0,
    gridW: 1,
    gridH: 1,
    sortOrder: 64,
  },
];

export class ItemRepriceAndGachaDeliver1787900000008 implements MigrationInterface {
  name = 'ItemRepriceAndGachaDeliver1787900000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "gacha_draw" ADD "delivered" boolean NOT NULL DEFAULT false`,
    );

    for (const it of CATALOG) {
      // 按 key 定位；目录里没有的 key（运营自建商品）一律不碰
      await queryRunner.query(
        `UPDATE "item_def" SET "price" = $2, "comfort" = $3, "grid_w" = $4, "grid_h" = $5, "sort_order" = $6 WHERE "key" = $1`,
        [it.key, it.price, it.comfort, it.gridW, it.gridH, it.sortOrder],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 旧价目表不再保留：回滚只撤列，价格保持新口径。
    // 把 18700 的目录退回 6900 会让「三天买断全部收藏品」的经济漏洞重新出现，
    // 这不是回滚该做的事。真要改价，走后台或新迁移。
    await queryRunner.query(`ALTER TABLE "gacha_draw" DROP COLUMN "delivered"`);
  }
}
