import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 通用登录（脱离微信）：为 `user` 表补 `username` 与 `password_hash` 两列。
 *
 * 背景：前端从微信小游戏扩展到 Unity（原生/WebGL/Steam 等）后，需要不依赖
 * 微信 code 的身份来源。设备登录（匿名游客）无需口令；账号登录（用户名+口令）
 * 与「设备账号绑定用户名」才需要 username + 散列。
 *
 * username 用独立列而非塞进 openid：设备玩家绑定账号后 openid 仍是 `device_openid_*`
 * （设备登录照常命中），账号登录按 username 查找，两条路互不干扰。
 *
 * 两列均可空：微信/设备/mock 玩家恒为 null。username 唯一索引在 Postgres 下允许
 * 多个 null，故对无用户名玩家无影响。
 */
export class UserGenericLogin1787900300000 implements MigrationInterface {
  name = 'UserGenericLogin1787900300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username" character varying(32)`,
    );
    await q.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "password_hash" character varying(255)`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_username" ON "user" ("username")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_user_username"`);
    await q.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "password_hash"`);
    await q.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "username"`);
  }
}
