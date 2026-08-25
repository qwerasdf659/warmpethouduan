import { MigrationInterface, QueryRunner } from 'typeorm';

export class GameConfig1787626627685 implements MigrationInterface {
  name = 'GameConfig1787626627685';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "game_config" ("id" BIGSERIAL NOT NULL, "key" character varying(64) NOT NULL, "description" character varying(128) NOT NULL DEFAULT '', "value" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6572e2a84c4c5d72a9227e0b894" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_game_config_key" ON "game_config"  ("key") `,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_def" ALTER COLUMN "meta" SET DEFAULT '{}'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "item_def" ALTER COLUMN "meta" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_game_config_key"`);
    await queryRunner.query(`DROP TABLE "game_config"`);
  }
}
