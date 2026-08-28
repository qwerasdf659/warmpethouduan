import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 把「积分池」这个中间概念从表结构里去掉，统一用资产 code。
 *
 * 原状是双轨：账本、对账、风控、流水全按 `asset_code` 说话，而 promo / exchange /
 * gacha 三个域各自存一个 `pool ∈ {game, marketing}`，靠一张 `POOL_ASSET` 映射表
 * 在边界上翻译。代价不是那次翻译，而是**同一件事有两种写法**——
 * 「按池筛」和「按 code 筛」的结果差异只能靠读代码解释，
 * 而且池只有两个值，`cons_snack +3` 在池维度下会显示成「游戏币 +3」。
 *
 * 四张表都是空表，所以这里只改列不搬数据。真有存量时应当是
 * `UPDATE ... SET asset_code = CASE pool WHEN 'game' THEN 'game_coin' ...`。
 */
export class PoolToAssetCode1787900800000 implements MigrationInterface {
  name = 'PoolToAssetCode1787900800000';

  public async up(q: QueryRunner): Promise<void> {
    // promo_code 上原有一条只允许 game/marketing 的 CHECK，先摘掉再改列
    await q.query(
      `ALTER TABLE "promo_code" DROP CONSTRAINT IF EXISTS "ck_promo_code_pool"`,
    );

    for (const table of [
      'promo_code',
      'promo_redemption',
      'redeem_order',
      'gacha_draw',
    ]) {
      await q.query(
        `ALTER TABLE "${table}" RENAME COLUMN "pool" TO "asset_code"`,
      );
      // 池名最长 9 个字符，资产 code 要 48
      await q.query(
        `ALTER TABLE "${table}" ALTER COLUMN "asset_code" TYPE character varying(48)`,
      );
    }

    await q.query(
      `ALTER TABLE "promo_code" ADD CONSTRAINT "ck_promo_code_asset"
         CHECK ("asset_code" IN ('game_coin','marketing_point'))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "promo_code" DROP CONSTRAINT IF EXISTS "ck_promo_code_asset"`,
    );
    for (const table of [
      'promo_code',
      'promo_redemption',
      'redeem_order',
      'gacha_draw',
    ]) {
      await q.query(
        `ALTER TABLE "${table}" ALTER COLUMN "asset_code" TYPE character varying(16)`,
      );
      await q.query(
        `ALTER TABLE "${table}" RENAME COLUMN "asset_code" TO "pool"`,
      );
    }
    await q.query(
      `ALTER TABLE "promo_code" ADD CONSTRAINT "ck_promo_code_pool"
         CHECK ("pool" IN ('game','marketing'))`,
    );
  }
}
