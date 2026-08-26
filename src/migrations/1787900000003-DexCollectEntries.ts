import { MigrationInterface, QueryRunner } from 'typeorm';

interface StoredDexEntry {
  key: string;
  [k: string]: unknown;
}

/** 新增的收集类图鉴条目（与 dex.config.ts 的默认值一致）。 */
const COLLECT_ENTRIES: StoredDexEntry[] = [
  {
    key: 'skin3',
    name: '衣橱初成',
    desc: '收集 3 种皮肤',
    type: 'ownedSkin',
    target: 3,
    reward: 120,
    sortOrder: 30,
  },
  {
    key: 'acc3',
    name: '配饰收藏家',
    desc: '收集 3 种配饰',
    type: 'ownedAccessory',
    target: 3,
    reward: 120,
    sortOrder: 31,
  },
  {
    key: 'furn4',
    name: '安乐窝',
    desc: '收集 4 种家具',
    type: 'ownedFurniture',
    target: 4,
    reward: 200,
    sortOrder: 32,
  },
  {
    key: 'collect10',
    name: '博物学家',
    desc: '累计收集 10 种物品',
    type: 'ownedAll',
    target: 10,
    reward: 400,
    sortOrder: 40,
  },
];

/**
 * 把「收集装扮/家具点亮图鉴」补进存量 `dex.entries`。
 *
 * 此前图鉴只有养成类条目（等级/宠物数/亲密度），买皮肤家具不影响任何图鉴格，
 * 与规格里「获得装扮/家具 → 点亮一格」不符。
 *
 * 按 key 去重后追加：运营可能已经手动加过同名条目，重复 key 会让
 * `getDexEntry()` 只命中第一条、另一条永远领不到奖。
 */
export class DexCollectEntries1787900000003 implements MigrationInterface {
  name = 'DexCollectEntries1787900000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT value FROM game_config WHERE key = 'dex.entries'`,
    )) as { value: StoredDexEntry[] }[];
    if (!rows.length) return;

    const existing = new Set(rows[0].value.map((e) => e.key));
    const toAdd = COLLECT_ENTRIES.filter((e) => !existing.has(e.key));
    if (!toAdd.length) return;

    await queryRunner.query(
      `UPDATE game_config SET value = $1, updated_at = now() WHERE key = 'dex.entries'`,
      [JSON.stringify([...rows[0].value, ...toAdd])],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT value FROM game_config WHERE key = 'dex.entries'`,
    )) as { value: StoredDexEntry[] }[];
    if (!rows.length) return;

    const drop = new Set(COLLECT_ENTRIES.map((e) => e.key));
    await queryRunner.query(
      `UPDATE game_config SET value = $1, updated_at = now() WHERE key = 'dex.entries'`,
      [JSON.stringify(rows[0].value.filter((e) => !drop.has(e.key)))],
    );
  }
}
