import { MigrationInterface, QueryRunner } from 'typeorm';

export class PetMultiAndStats1787621011377 implements MigrationInterface {
  name = 'PetMultiAndStats1787621011377';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_pet_user_id"`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD "last_seen_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "nickname" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "species" character varying(32) NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "stamina" integer NOT NULL DEFAULT '100'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "intimacy" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" DROP CONSTRAINT "FK_64704296b7bd17e90ca0a620a98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" DROP CONSTRAINT "REL_64704296b7bd17e90ca0a620a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ALTER COLUMN "hunger" SET DEFAULT '80'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ALTER COLUMN "cleanliness" SET DEFAULT '80'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pet_user_id" ON "pet"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_active_per_user" ON "pet" ("user_id") WHERE is_active = true`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD CONSTRAINT "FK_64704296b7bd17e90ca0a620a98" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pet" DROP CONSTRAINT "FK_64704296b7bd17e90ca0a620a98"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_pet_active_per_user"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pet_user_id"`);
    await queryRunner.query(
      `ALTER TABLE "pet" ALTER COLUMN "cleanliness" SET DEFAULT '100'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ALTER COLUMN "hunger" SET DEFAULT '100'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD CONSTRAINT "REL_64704296b7bd17e90ca0a620a9" UNIQUE ("user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD CONSTRAINT "FK_64704296b7bd17e90ca0a620a98" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "intimacy"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "stamina"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "is_active"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "species"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "nickname"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "last_seen_at"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_user_id" ON "pet" USING btree ("user_id") `,
    );
  }
}
