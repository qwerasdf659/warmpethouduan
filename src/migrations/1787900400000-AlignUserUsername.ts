import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 补齐 `user.username`（账号通用登录）。
 *
 * 背景：`UserGenericLogin1787900300000` 迁移在本开发库被记录为已执行时，其内容只加了
 * `password_hash`；此后该迁移与 `User` 实体被补入 `username` 列（账号登录按用户名查找，
 * `auth.service` / `account-auth.dto` 已在消费该列），但因原迁移已在 `migrations` 表登记，
 * TypeORM 不会重跑，导致本库缺列 —— 任何按 username 的登录/查询会 500。
 *
 * 本迁移用 IF NOT EXISTS 幂等补列 + 唯一索引：对已含该列的全新重建库为 no-op，
 * 对本开发库补齐缺口。唯一索引在 Postgres 下允许多个 NULL，不影响无用户名的绝大多数玩家。
 */
export class AlignUserUsername1787900400000 implements MigrationInterface {
  name = 'AlignUserUsername1787900400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username" character varying(32)`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_username" ON "user" ("username")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_user_username"`);
    await q.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "username"`);
  }
}
