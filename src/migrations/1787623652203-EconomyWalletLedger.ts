import { MigrationInterface, QueryRunner } from 'typeorm';

export class EconomyWalletLedger1787623652203 implements MigrationInterface {
  name = 'EconomyWalletLedger1787623652203';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ledger" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pool" character varying(16) NOT NULL, "delta" bigint NOT NULL, "balance_after" bigint NOT NULL, "biz_id" character varying(128) NOT NULL, "reason" character varying(32) NOT NULL, "ref_id" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_ledger_delta_nonzero" CHECK ("delta" <> 0), CONSTRAINT "ck_ledger_pool" CHECK ("pool" IN ('game','marketing')), CONSTRAINT "PK_7a322e9157e5f42a16750ba2a20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ledger_user_id_id" ON "ledger"  ("user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ledger_user_biz_pool" ON "ledger"  ("user_id", "biz_id", "pool") `,
    );
    await queryRunner.query(
      `CREATE TABLE "wallet" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "game_coin" bigint NOT NULL DEFAULT '0', "marketing_point" bigint NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_wallet_non_negative" CHECK ("game_coin" >= 0 AND "marketing_point" >= 0), CONSTRAINT "PK_bec464dd8d54c39c54fd32e2334" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wallet_user_id" ON "wallet"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger" ADD CONSTRAINT "FK_f010927e851c0368a15c587f89a" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" ADD CONSTRAINT "FK_72548a47ac4a996cd254b082522" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet" DROP CONSTRAINT "FK_72548a47ac4a996cd254b082522"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger" DROP CONSTRAINT "FK_f010927e851c0368a15c587f89a"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_wallet_user_id"`);
    await queryRunner.query(`DROP TABLE "wallet"`);
    await queryRunner.query(`DROP INDEX "public"."uq_ledger_user_biz_pool"`);
    await queryRunner.query(`DROP INDEX "public"."idx_ledger_user_id_id"`);
    await queryRunner.query(`DROP TABLE "ledger"`);
  }
}
