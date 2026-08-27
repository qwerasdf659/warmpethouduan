import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 回填存量资产的 `meta.rarity`（P8 稀有度）。
 *
 * 按价格/限量分档（价格在 meta.price）：限量或 >=4000 传说，>=1500 史诗，
 * >=800 稀有，>=300 优秀，其余普通。货币（game_coin/marketing_point）无稀有度。
 *
 * 幂等：`NOT (meta ? 'rarity')` 只补未打标的行，不覆盖已有值（如播种自带 rarity 的 Petpet）。
 * 与 `items.rarities` 配置的档位 key 对齐。
 */
export class BackfillAssetRarity1787847700000 implements MigrationInterface {
  name = 'BackfillAssetRarity1787847700000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE asset_def
      SET meta = meta || jsonb_build_object('rarity',
        CASE
          WHEN mint_limit IS NOT NULL OR COALESCE((meta->>'price')::int, 0) >= 4000 THEN 'legendary'
          WHEN COALESCE((meta->>'price')::int, 0) >= 1500 THEN 'epic'
          WHEN COALESCE((meta->>'price')::int, 0) >= 800 THEN 'rare'
          WHEN COALESCE((meta->>'price')::int, 0) >= 300 THEN 'uncommon'
          ELSE 'common'
        END)
      WHERE kind <> 'currency' AND NOT (meta ? 'rarity')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE asset_def SET meta = meta - 'rarity' WHERE kind <> 'currency'`,
    );
  }
}
