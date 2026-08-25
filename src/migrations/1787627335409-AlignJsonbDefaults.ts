import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 对齐 jsonb 列默认值的存储形态：早期建表迁移写的是 `'{}'` / `'[]'`（无 `::jsonb` 强转），
 * 而实体声明为 `'{}'::jsonb` / `'[]'::jsonb`。二者默认值等价，但 `migration:generate`
 * 会持续把这点差异识别为「漂移」。此迁移把 DB 侧改为带强转的形态，使实体与库彻底一致，
 * 消除后续每次生成都冒出的空 ALTER。
 */
export class AlignJsonbDefaults1787627335409 implements MigrationInterface {
  name = 'AlignJsonbDefaults1787627335409';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_config" ALTER COLUMN "value" SET DEFAULT '{}'::jsonb`,
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
      `ALTER TABLE "game_config" ALTER COLUMN "value" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ALTER COLUMN "claimed_tasks" SET DEFAULT '[]'`,
    );
  }
}
