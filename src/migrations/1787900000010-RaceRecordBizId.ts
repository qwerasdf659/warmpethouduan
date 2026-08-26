import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * race_record 补上业务幂等键，与 ledger / gacha_draw 的去重强度对齐。
 *
 * 此前门票扣费走经济域的永久幂等（ledger 唯一索引，无 TTL），而报名本身只靠
 * Redis 拦截器的 24h 窗口。两边 TTL 不对称 → 用超过 24h 的旧 bizId 重放
 * /race/start，门票被幂等吃掉、却新建一场可结算的比赛，等于免费赛。
 *
 * 列可空：历史行没有该键。Postgres 唯一索引视 NULL 互不相等，老行不会互相冲突。
 */
export class RaceRecordBizId1787900000010 implements MigrationInterface {
  name = 'RaceRecordBizId1787900000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "race_record" ADD "biz_id" character varying(128)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_race_record_user_biz" ON "race_record" ("user_id", "biz_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_race_record_user_biz"`);
    await queryRunner.query(`ALTER TABLE "race_record" DROP COLUMN "biz_id"`);
  }
}
