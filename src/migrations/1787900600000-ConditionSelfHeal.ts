import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 病症自愈的计时锚点。
 *
 * `pet.cure` 一直配着 `selfHealStat` / `selfHealHours`，`pet_condition.cured_by`
 * 也一直允许 `'self'`，但没有任何代码消费它们——接口对外宣称
 * `curableBy: ['item','clinic','self']`，实际只有前两种能用。
 *
 * 补这一列是为了让「维持 N 小时」可判定：属性只能推出「此刻是否达标」，
 * 推不出「已经达标多久」。
 */
export class ConditionSelfHeal1787900600000 implements MigrationInterface {
  name = 'ConditionSelfHeal1787900600000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "pet_condition" ADD COLUMN IF NOT EXISTS "healthy_since" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "pet_condition" DROP COLUMN IF EXISTS "healthy_since"`,
    );
  }
}
