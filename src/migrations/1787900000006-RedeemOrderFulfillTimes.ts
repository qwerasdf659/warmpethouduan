import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `redeem_order` 补发货/取消时间列。
 *
 * 此前只有 `updated_at`，而它会被补物流单号、改备注等任何写操作刷新，
 * 用它算「下单到发货耗时」会系统性偏短，履约时效没法考核。
 *
 * 存量行做**一次性近似回填**：终态订单的 `updated_at` 绝大多数就是那次状态流转的
 * 时间（履约后很少再改备注），比留 null 有用。回填只跑这一次，之后由代码写准确值。
 */
export class RedeemOrderFulfillTimes1787900000006 implements MigrationInterface {
  name = 'RedeemOrderFulfillTimes1787900000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "redeem_order" ADD "shipped_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "redeem_order" ADD "cancelled_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE redeem_order SET shipped_at = updated_at WHERE status = 'shipped'`,
    );
    await queryRunner.query(
      `UPDATE redeem_order SET cancelled_at = updated_at WHERE status = 'cancelled'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "redeem_order" DROP COLUMN "cancelled_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "redeem_order" DROP COLUMN "shipped_at"`,
    );
  }
}
