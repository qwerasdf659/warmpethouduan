import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 兑换码（`promo_code` / `promo_redemption`）与扭蛋（`gacha_draw` / `gacha_state`）建表。
 *
 * 两块合在一条迁移里，是因为它们的实体都已提交并由 `src/data-source.ts` 的 glob 登记，
 * 只建其一会让另一半永远出现在 `migration:generate` 的产物里，drift 检查再也回不到空。
 *
 * 兑换码是营销积分**唯一的玩家侧入口**（待办清单 B6）：此前 10 个源文件、模块挂载、
 * 配置注册、`LEDGER_REASONS` 都已就位，唯独缺这条迁移，所以 `POST /promo/redeem`
 * 线上直接 500。
 *
 * 扭蛋目前**只有实体**（模块/服务/控制器尚未实现），建出来是两张空表，不影响任何现有链路；
 * 等实现补齐即可直接用，不必再改表结构。
 *
 * 约束的取舍（与实体注释一致，改表时别顺手删）：
 *  - `uq_promo_redemption_code_user`：「每码每人一次」的唯一依据。并发下两个请求同时
 *    通过 COUNT 检查是必然的，只有唯一索引能让其中一个插入失败。
 *  - `uq_gacha_draw_user_biz`：抽奖的幂等键，语义同 ledger 的 `(user_id,biz_id,pool)`。
 *  - `ck_promo_code_*`：面额为正、池名合法、次数非负，在库层兜住后台写入的脏数据。
 */
export class PromoAndGacha1787900000007 implements MigrationInterface {
  name = 'PromoAndGacha1787900000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "gacha_draw" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pool_key" character varying(48) NOT NULL, "biz_id" character varying(128) NOT NULL, "times" integer NOT NULL, "cost" integer NOT NULL, "pool" character varying(16) NOT NULL, "prizes" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f753a0a2f37965b560f76509870" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_gacha_draw_user_id" ON "gacha_draw"  ("user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_gacha_draw_user_biz" ON "gacha_draw"  ("user_id", "biz_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "gacha_state" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pool_key" character varying(48) NOT NULL, "pity" integer NOT NULL DEFAULT '0', "total_draws" integer NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_82e33f882a6978f1399b361ff90" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_gacha_state_user_pool" ON "gacha_state"  ("user_id", "pool_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "promo_code" ("id" BIGSERIAL NOT NULL, "code" character varying(32) NOT NULL, "batch" character varying(48) NOT NULL, "pool" character varying(16) NOT NULL, "amount" integer NOT NULL, "max_uses" integer NOT NULL DEFAULT '1', "used_count" integer NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE, "enabled" boolean NOT NULL DEFAULT true, "remark" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_promo_code_uses" CHECK ("max_uses" > 0 AND "used_count" >= 0), CONSTRAINT "ck_promo_code_pool" CHECK ("pool" IN ('game','marketing')), CONSTRAINT "ck_promo_code_amount" CHECK ("amount" > 0), CONSTRAINT "PK_ded0af550884c7ab3e345e76d73" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_promo_code_code" ON "promo_code"  ("code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_promo_code_batch" ON "promo_code"  ("batch") `,
    );
    await queryRunner.query(
      `CREATE TABLE "promo_redemption" ("id" BIGSERIAL NOT NULL, "code_id" bigint NOT NULL, "user_id" bigint NOT NULL, "code" character varying(32) NOT NULL, "pool" character varying(16) NOT NULL, "amount" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_50eb74e71de2ff0f14720033736" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_promo_redemption_user_id" ON "promo_redemption"  ("user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_promo_redemption_code_user" ON "promo_redemption"  ("code_id", "user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "gacha_draw" ADD CONSTRAINT "FK_dd42eca4c0457ee9564d55cb00f" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gacha_state" ADD CONSTRAINT "FK_0a6a7eaf7f518dba873c28768bc" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "promo_redemption" ADD CONSTRAINT "FK_018ff8b7ff44a91868b457f62ac" FOREIGN KEY ("code_id") REFERENCES "promo_code"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "promo_redemption" ADD CONSTRAINT "FK_247449961248b17630591784161" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "promo_redemption" DROP CONSTRAINT "FK_247449961248b17630591784161"`,
    );
    await queryRunner.query(
      `ALTER TABLE "promo_redemption" DROP CONSTRAINT "FK_018ff8b7ff44a91868b457f62ac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gacha_state" DROP CONSTRAINT "FK_0a6a7eaf7f518dba873c28768bc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gacha_draw" DROP CONSTRAINT "FK_dd42eca4c0457ee9564d55cb00f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_promo_redemption_code_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_promo_redemption_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "promo_redemption"`);
    await queryRunner.query(`DROP INDEX "public"."idx_promo_code_batch"`);
    await queryRunner.query(`DROP INDEX "public"."uq_promo_code_code"`);
    await queryRunner.query(`DROP TABLE "promo_code"`);
    await queryRunner.query(`DROP INDEX "public"."uq_gacha_state_user_pool"`);
    await queryRunner.query(`DROP TABLE "gacha_state"`);
    await queryRunner.query(`DROP INDEX "public"."uq_gacha_draw_user_biz"`);
    await queryRunner.query(`DROP INDEX "public"."idx_gacha_draw_user_id"`);
    await queryRunner.query(`DROP TABLE "gacha_draw"`);
  }
}
