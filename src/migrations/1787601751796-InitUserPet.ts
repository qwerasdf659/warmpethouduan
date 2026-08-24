import { MigrationInterface, QueryRunner } from "typeorm";

export class InitUserPet1787601751796 implements MigrationInterface {
    name = 'InitUserPet1787601751796'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "user" ("id" BIGSERIAL NOT NULL, "unionid" character varying(64), "openid" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_user_unionid" ON "user"  ("unionid") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_user_openid" ON "user"  ("openid") `);
        await queryRunner.query(`CREATE TABLE "pet" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "hunger" integer NOT NULL DEFAULT '100', "mood" integer NOT NULL DEFAULT '80', "cleanliness" integer NOT NULL DEFAULT '100', "level" integer NOT NULL DEFAULT '1', "exp" integer NOT NULL DEFAULT '0', "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_64704296b7bd17e90ca0a620a9" UNIQUE ("user_id"), CONSTRAINT "PK_b1ac2e88e89b9480e0c5b53fa60" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_pet_user_id" ON "pet"  ("user_id") `);
        await queryRunner.query(`ALTER TABLE "pet" ADD CONSTRAINT "FK_64704296b7bd17e90ca0a620a98" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "pet" DROP CONSTRAINT "FK_64704296b7bd17e90ca0a620a98"`);
        await queryRunner.query(`DROP INDEX "public"."uq_pet_user_id"`);
        await queryRunner.query(`DROP TABLE "pet"`);
        await queryRunner.query(`DROP INDEX "public"."uq_user_openid"`);
        await queryRunner.query(`DROP INDEX "public"."uq_user_unionid"`);
        await queryRunner.query(`DROP TABLE "user"`);
    }

}
