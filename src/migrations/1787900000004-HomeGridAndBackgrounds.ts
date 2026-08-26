import { MigrationInterface, QueryRunner } from 'typeorm';

/** 存量家具的占格尺寸（与 item-seed.ts 一致）。 */
const FURNITURE_SIZE: Record<string, [number, number]> = {
  furn_mat: [2, 2],
  furn_sofa: [2, 1],
  furn_lamp: [1, 1],
  furn_tree: [1, 2],
};

/** 背景装扮：走 accessory 类型 + bg 槽位，启用此前形同虚设的背景部位。 */
const BACKGROUNDS = [
  { key: 'bg_room', name: '暖阳小屋', price: 0, sortOrder: 15 },
  { key: 'bg_garden', name: '午后花园', price: 350, sortOrder: 16 },
  { key: 'bg_starry', name: '星夜露台', price: 700, sortOrder: 17 },
];

/**
 * 家园网格化 + 启用背景槽位。
 *
 * 此前 `home_layout` 只存自由坐标（上界 10000、可省略默认 0），没有边界也没有
 * 重叠校验，同一格能叠无限件家具——对 comfort 计算无害（按件累加），但前端一做
 * 布局 UI 就会看到家具堆在原点或飘到房间外。这里补 `grid_w`/`grid_h` 占格尺寸
 * 与 `home.grid` 房间尺寸配置，校验逻辑在 `HomeService.resolveSpot()`。
 *
 * **不迁移存量摆放坐标**：存量数据全是 (0,0)（前端还没做布局，一直用默认值），
 * 按新规则它们互相重叠，但重叠校验只在**新增摆放**时生效，旧数据不会因此报错；
 * 玩家收纳再摆放即自动归位到合法空位。强行按网格重排反而会打乱玩家的布置意图。
 */
export class HomeGridAndBackgrounds1787900000004 implements MigrationInterface {
  name = 'HomeGridAndBackgrounds1787900000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "item_def" ADD "grid_w" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_def" ADD "grid_h" integer NOT NULL DEFAULT 1`,
    );

    for (const [key, [w, h]] of Object.entries(FURNITURE_SIZE)) {
      await queryRunner.query(
        `UPDATE item_def SET grid_w = $1, grid_h = $2, updated_at = now() WHERE key = $3`,
        [w, h, key],
      );
    }

    for (const bg of BACKGROUNDS) {
      await queryRunner.query(
        `INSERT INTO item_def (key, type, name, slot, price, pool, comfort, grid_w, grid_h, meta, enabled, sort_order)
         VALUES ($1, 'accessory', $2, 'bg', $3, 'game', 0, 1, 1, '{}'::jsonb, true, $4)
         ON CONFLICT (key) DO NOTHING`,
        [bg.key, bg.name, bg.price, bg.sortOrder],
      );
    }

    await queryRunner.query(
      `INSERT INTO game_config (key, description, value)
       VALUES ('home.grid', $1, $2::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [
        '家园房间网格尺寸（格）。缩小后已越界的旧摆放不会被自动清理',
        JSON.stringify({ width: 6, height: 6 }),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM game_config WHERE key = 'home.grid'`);
    // 背景可能已被玩家购买，删定义会让 item_owned 出现悬空引用，故只下架不删除
    await queryRunner.query(
      `UPDATE item_def SET enabled = false WHERE key IN (${BACKGROUNDS.map(
        (_, i) => `$${i + 1}`,
      ).join(', ')})`,
      BACKGROUNDS.map((b) => b.key),
    );
    await queryRunner.query(`ALTER TABLE "item_def" DROP COLUMN "grid_h"`);
    await queryRunner.query(`ALTER TABLE "item_def" DROP COLUMN "grid_w"`);
  }
}
