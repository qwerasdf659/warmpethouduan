import { MigrationInterface, QueryRunner } from 'typeorm';

interface StoredExchangeItem {
  key: string;
  type: 'physical' | 'virtual';
  stock?: number | null;
  perUserLimit?: number | null;
  [k: string]: unknown;
}

/**
 * 给存量的 `exchange.items` 配置补上 `stock` / `perUserLimit`。
 *
 * 这两个字段在 schema 里是 `required()`（允许为 null，但必须显式写出来），
 * 存量行缺字段会被判为非法配置、静默回退到代码默认值 —— 后台看到的值与实际生效的值不一致。
 *
 * 补值规则按类型给保守起点，运营可在配置中心随时调整：
 *   - virtual：不限量（null / null），虚拟奖励没有备货成本
 *   - physical：库存 100 件、每人 1 件，备货是真金白银，宁可运营主动放开
 */
export class ExchangeStockConfig1787900000001 implements MigrationInterface {
  name = 'ExchangeStockConfig1787900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT value FROM game_config WHERE key = 'exchange.items'`,
    )) as { value: StoredExchangeItem[] }[];
    if (!rows.length) return;

    const patched = rows[0].value.map((item) => ({
      ...item,
      stock: item.stock ?? (item.type === 'physical' ? 100 : null),
      perUserLimit: item.perUserLimit ?? (item.type === 'physical' ? 1 : null),
    }));

    await queryRunner.query(
      `UPDATE game_config SET value = $1, updated_at = now() WHERE key = 'exchange.items'`,
      [JSON.stringify(patched)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT value FROM game_config WHERE key = 'exchange.items'`,
    )) as { value: StoredExchangeItem[] }[];
    if (!rows.length) return;

    const stripped = rows[0].value.map((item) => {
      const { stock: _stock, perUserLimit: _limit, ...rest } = item;
      return rest;
    });

    await queryRunner.query(
      `UPDATE game_config SET value = $1, updated_at = now() WHERE key = 'exchange.items'`,
      [JSON.stringify(stripped)],
    );
  }
}
