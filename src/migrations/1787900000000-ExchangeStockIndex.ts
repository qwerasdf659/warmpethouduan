import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 兑换库存/限购的支撑索引。
 *
 * 库存与每人限购的已用量都是从 `redeem_order` 实时数出来的（排除 cancelled），
 * 不存计数器，所以每次下单都会跑两条 COUNT：
 *   - 全站库存：WHERE exchange_key = ? AND status <> 'cancelled'
 *   - 每人限购：WHERE user_id = ? AND exchange_key = ? AND status <> 'cancelled'
 * 现有索引是 (status, id) 与 (user_id, biz_id)，都命不中这两条。
 */
export class ExchangeStockIndex1787900000000 implements MigrationInterface {
  name = 'ExchangeStockIndex1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_redeem_order_key_status" ON "redeem_order" ("exchange_key", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_redeem_order_user_key_status" ON "redeem_order" ("user_id", "exchange_key", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_redeem_order_user_key_status"`);
    await queryRunner.query(`DROP INDEX "idx_redeem_order_key_status"`);
  }
}
