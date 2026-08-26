import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 删除 home_stat —— 家园舒适度的反范式快照。
 *
 * 舒适度改为从 `home_layout ⋈ item_def` 实时聚合（HomeComfortService）。
 * 快照有两个必然漂移的口子：后台改 `item_def.comfort` 不回写快照；增量维护本身
 * 是「先读后写」。漂移后没有任何地方会把它算回来，玩家只会看到心情莫名掉得快。
 *
 * 无需数据迁移：新口径直接从摆放行算出，本就是这张表想缓存的那个值。
 */
export class DropHomeStat1787900000011 implements MigrationInterface {
  name = 'DropHomeStat1787900000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "home_stat"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "home_stat" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "comfort" integer NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_318dbf2e41c8ae84b1659a7ec10" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_home_stat_user" ON "home_stat"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "home_stat" ADD CONSTRAINT "FK_43e36523c627b08aedfb3571861" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // 回滚后按当前摆放重算，避免留下一张全 0 的快照
    await queryRunner.query(
      `INSERT INTO "home_stat" ("user_id", "comfort")
       SELECT l.user_id, COALESCE(SUM(d.comfort), 0)
         FROM "home_layout" l
         JOIN "item_def" d ON d.id = l.item_def_id
        GROUP BY l.user_id`,
    );
  }
}
