import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 记忆翻牌的服务端对局状态。
 *
 * 原实现让客户端批量提交操作序列、服务端用一个占位函数算分。那个形态下
 * 服务端权威根本无法成立：牌面要么提前下发（客户端可直接构造满分序列），
 * 要么保密（客户端只能瞎翻）。改成「服务端独占牌面 + 逐次 flip 揭示」，
 * 进度就必须落库。
 *
 * 牌面不落库：它由 `seed` 确定性推导，存一份只会多一个可能与 seed 打架的真相。
 */
export class MinigameBoardState1787900700000 implements MigrationInterface {
  name = 'MinigameBoardState1787900700000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "minigame_session"
         ADD COLUMN IF NOT EXISTS "state" jsonb NOT NULL
         DEFAULT '{"matched":[],"attempts":0,"pending":null}'::jsonb`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "minigame_session" DROP COLUMN IF EXISTS "state"`,
    );
  }
}
