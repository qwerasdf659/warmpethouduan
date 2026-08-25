import { MigrationInterface, QueryRunner } from 'typeorm';

export class DailyAndOffline1787625010537 implements MigrationInterface {
  name = 'DailyAndOffline1787625010537';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "daily" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "last_checkin_day" character varying(8), "streak" integer NOT NULL DEFAULT '0', "total_checkins" integer NOT NULL DEFAULT '0', "task_day" character varying(8), "claimed_tasks" jsonb NOT NULL DEFAULT '[]'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2f5e6c9d57ae96fad69b6f97bd5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_daily_user_id" ON "daily"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "offline_base_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ADD CONSTRAINT "FK_25e35cb9536505aa9646c761f8b" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "daily" DROP CONSTRAINT "FK_25e35cb9536505aa9646c761f8b"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "offline_base_at"`);
    await queryRunner.query(`DROP INDEX "public"."uq_daily_user_id"`);
    await queryRunner.query(`DROP TABLE "daily"`);
  }
}
