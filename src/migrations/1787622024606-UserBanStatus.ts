import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserBanStatus1787622024606 implements MigrationInterface {
  name = 'UserBanStatus1787622024606';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "status" character varying(16) NOT NULL DEFAULT 'active'`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "banned_reason" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "banned_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "banned_at"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "banned_reason"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "status"`);
  }
}
