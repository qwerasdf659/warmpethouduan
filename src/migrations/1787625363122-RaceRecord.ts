import { MigrationInterface, QueryRunner } from 'typeorm';

export class RaceRecord1787625363122 implements MigrationInterface {
  name = 'RaceRecord1787625363122';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "race_record" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pet_id" bigint NOT NULL, "track_key" character varying(32) NOT NULL, "pet_level" integer NOT NULL, "score" integer NOT NULL, "rank" integer NOT NULL, "total_racers" integer NOT NULL, "reward_coin" integer NOT NULL DEFAULT '0', "stamina_cost" integer NOT NULL DEFAULT '0', "status" character varying(16) NOT NULL DEFAULT 'pending', "settled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_10284084d4f1ca58adcc18649c1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_race_user_id_id" ON "race_record"  ("user_id", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "race_record" ADD CONSTRAINT "FK_e003c328c682f30cdb896bb0b48" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "race_record" DROP CONSTRAINT "FK_e003c328c682f30cdb896bb0b48"`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_race_user_id_id"`);
    await queryRunner.query(`DROP TABLE "race_record"`);
  }
}
