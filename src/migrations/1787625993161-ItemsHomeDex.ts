import { MigrationInterface, QueryRunner } from 'typeorm';

export class ItemsHomeDex1787625993161 implements MigrationInterface {
  name = 'ItemsHomeDex1787625993161';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "dex_claim" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "entry_key" character varying(48) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3e6fe51fcc9a1184c73b7314f19" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_dex_claim_user_entry" ON "dex_claim"  ("user_id", "entry_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "home_layout" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "item_def_id" bigint NOT NULL, "pos_x" integer NOT NULL DEFAULT '0', "pos_y" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a468bc5ba466b37be32eb30167e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_home_layout_user" ON "home_layout"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "home_stat" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "comfort" integer NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_318dbf2e41c8ae84b1659a7ec10" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_home_stat_user" ON "home_stat"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "item_def" ("id" BIGSERIAL NOT NULL, "key" character varying(48) NOT NULL, "type" character varying(16) NOT NULL, "name" character varying(48) NOT NULL, "slot" character varying(24), "price" integer NOT NULL DEFAULT '0', "pool" character varying(16) NOT NULL DEFAULT 'game', "comfort" integer NOT NULL DEFAULT '0', "meta" jsonb NOT NULL DEFAULT '{}'::jsonb, "enabled" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2e42b1c6dc6ea328768c3a58377" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_item_def_key" ON "item_def"  ("key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "item_owned" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "item_def_id" bigint NOT NULL, "qty" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e61d9fcd86b5826709ee4b77afc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_item_owned_user_item" ON "item_owned"  ("user_id", "item_def_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pet_equip" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pet_id" bigint NOT NULL, "slot" character varying(24) NOT NULL, "item_def_id" bigint NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b32e425056fe205fd0c0989711e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_equip_pet_slot" ON "pet_equip"  ("pet_id", "slot") `,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "dex_claim" ADD CONSTRAINT "FK_9958de4163849bbc8435beb4e27" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_layout" ADD CONSTRAINT "FK_613be8cbae47640020ccfb08d77" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_stat" ADD CONSTRAINT "FK_43e36523c627b08aedfb3571861" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_owned" ADD CONSTRAINT "FK_948b1e531b87c90c120971fd776" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_equip" ADD CONSTRAINT "FK_3d14a2cdc6ad815a88cc03993fd" FOREIGN KEY ("pet_id") REFERENCES "pet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pet_equip" DROP CONSTRAINT "FK_3d14a2cdc6ad815a88cc03993fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_owned" DROP CONSTRAINT "FK_948b1e531b87c90c120971fd776"`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_stat" DROP CONSTRAINT "FK_43e36523c627b08aedfb3571861"`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_layout" DROP CONSTRAINT "FK_613be8cbae47640020ccfb08d77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dex_claim" DROP CONSTRAINT "FK_9958de4163849bbc8435beb4e27"`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_pet_equip_pet_slot"`);
    await queryRunner.query(`DROP TABLE "pet_equip"`);
    await queryRunner.query(`DROP INDEX "public"."uq_item_owned_user_item"`);
    await queryRunner.query(`DROP TABLE "item_owned"`);
    await queryRunner.query(`DROP INDEX "public"."uq_item_def_key"`);
    await queryRunner.query(`DROP TABLE "item_def"`);
    await queryRunner.query(`DROP INDEX "public"."uq_home_stat_user"`);
    await queryRunner.query(`DROP TABLE "home_stat"`);
    await queryRunner.query(`DROP INDEX "public"."idx_home_layout_user"`);
    await queryRunner.query(`DROP TABLE "home_layout"`);
    await queryRunner.query(`DROP INDEX "public"."uq_dex_claim_user_entry"`);
    await queryRunner.query(`DROP TABLE "dex_claim"`);
  }
}
