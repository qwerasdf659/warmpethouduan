import { MigrationInterface, QueryRunner } from 'typeorm';

export class PetStaminaBonus1787847624341 implements MigrationInterface {
  name = 'PetStaminaBonus1787847624341';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "stamina_bonus_bps" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pet" DROP COLUMN "stamina_bonus_bps"`,
    );
  }
}
