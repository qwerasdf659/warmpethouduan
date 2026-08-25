import { MigrationInterface, QueryRunner } from "typeorm";

export class RaceAdBoost1787659151481 implements MigrationInterface {
    name = 'RaceAdBoost1787659151481'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "race_record" ADD "reward_doubled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "race_record" ADD "revive_count" integer NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "race_record" DROP COLUMN "revive_count"`);
        await queryRunner.query(`ALTER TABLE "race_record" DROP COLUMN "reward_doubled"`);
    }

}
