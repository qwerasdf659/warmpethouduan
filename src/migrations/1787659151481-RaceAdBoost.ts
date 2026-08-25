import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 赛跑「看广告增值」：奖励翻倍 + 复活重跑。
 * `reward_doubled` 兼作翻倍发放的库层去重标记（每场至多一次）；
 * `revive_count` 限制每场重掷名次的次数，防止反复重跑刷到第一名。
 */
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
