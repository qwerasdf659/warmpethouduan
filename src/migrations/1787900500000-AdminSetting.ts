import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 后台控制台设置表（`admin_setting`）。
 *
 * 首个使用者是外观主题：运营改配色要立即对所有管理员生效，就不能写死在
 * 前端构建产物里，得有个服务端落点。见 `AdminSetting` 实体上关于「为何不
 * 复用 game_config」的说明。
 */
export class AdminSetting1787900500000 implements MigrationInterface {
  name = 'AdminSetting1787900500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "admin_setting" (
        "id" BIGSERIAL NOT NULL,
        "key" character varying(64) NOT NULL,
        "value" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_admin_setting" PRIMARY KEY ("id")
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_setting_key" ON "admin_setting" ("key")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_admin_setting_key"`);
    await q.query(`DROP TABLE IF EXISTS "admin_setting"`);
  }
}
