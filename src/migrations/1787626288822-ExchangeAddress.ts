import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExchangeAddress1787626288822 implements MigrationInterface {
  name = 'ExchangeAddress1787626288822';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "redeem_order" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "exchange_key" character varying(48) NOT NULL, "item_name" character varying(64) NOT NULL, "item_type" character varying(16) NOT NULL, "cost" integer NOT NULL, "pool" character varying(16) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "biz_id" character varying(128) NOT NULL, "address" jsonb, "tracking_no" character varying(64), "remark" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_70e651a21471ce8faabbb159afd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_redeem_status_id" ON "redeem_order"  ("status", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_redeem_user_biz" ON "redeem_order"  ("user_id", "biz_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_address" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "receiver" character varying(32) NOT NULL, "phone" character varying(20) NOT NULL, "region" character varying(128) NOT NULL, "detail" character varying(255) NOT NULL, "is_default" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_302d96673413455481d5ff4022a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_address_user" ON "user_address"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_def" ALTER COLUMN "meta" SET DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "redeem_order" ADD CONSTRAINT "FK_030ce95499f0fa1b4195ca59c1b" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_address" ADD CONSTRAINT "FK_29d6df815a78e4c8291d3cf5e53" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_address" DROP CONSTRAINT "FK_29d6df815a78e4c8291d3cf5e53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "redeem_order" DROP CONSTRAINT "FK_030ce95499f0fa1b4195ca59c1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_def" ALTER COLUMN "meta" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_user_address_user"`);
    await queryRunner.query(`DROP TABLE "user_address"`);
    await queryRunner.query(`DROP INDEX "public"."uq_redeem_user_biz"`);
    await queryRunner.query(`DROP INDEX "public"."idx_redeem_status_id"`);
    await queryRunner.query(`DROP TABLE "redeem_order"`);
  }
}
