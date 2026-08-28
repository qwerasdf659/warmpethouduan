import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 给玩法扩展的 9 张表补上指向 `user` 的外键。
 *
 * 这些表都有 `user_id` 列却没有外键，后果不是「理论上的完整性」而是两个具体问题：
 *
 *  1. `clean:dev` / `wipe:pre-launch` 靠**沿外键递归**发现关联数据（这样新增业务表
 *     自动纳入清理，不必维护一份会腐坏的表名清单）。没有外键的表发现不了，
 *     于是清档之后残留一批 `user_id` 指向已删账号的孤儿行——实测
 *     `minigame_session` 就积了一行。
 *  2. e2e 夹具只能靠硬编码表名兜着，而那份清单同样会随每张新表腐坏。
 *
 * 不加 `ON DELETE CASCADE`：与现有 11 张表的约定一致，删除顺序由 `sweep` 按外键
 * 拓扑序显式安排。CASCADE 会把「删一个玩家」变成无声的连锁删除，
 * 而清档脚本的价值恰恰在于**先报数、再删**。
 *
 * 约束名由 `migration:generate` 生成（TypeORM 的哈希命名）。刻意不用自定义名：
 * TypeORM 按自己的命名规则匹配外键，自定义名它认不出来，
 * 每次 drift 检查都会生成一条「DROP 再 ADD」的空迁移。
 */
export class PlayExpansionUserFks1787871695547 implements MigrationInterface {
  name = 'PlayExpansionUserFks1787871695547';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 先清孤儿行：有孤儿时 ADD CONSTRAINT 直接失败。这些行本身已是垃圾
    // （user_id 指向不存在的账号），留着只会让下一次清档继续漏掉它们
    for (const t of [
      'clinic',
      'clinic_case',
      'event_progress',
      'minigame_session',
      'pet_condition',
      'pet_egg',
      'pet_equip',
      'pet_trick',
      'pvp_rank',
    ]) {
      await queryRunner.query(
        `DELETE FROM "${t}" x
          WHERE NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = x."user_id")`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "clinic_case" ADD CONSTRAINT "FK_43a0a0eeaa04368af0582776483" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinic" ADD CONSTRAINT "FK_10cc3ad1543c70b0ac3d87892f2" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_progress" ADD CONSTRAINT "FK_7547dfd1acfd6903c69f2194d8e" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "minigame_session" ADD CONSTRAINT "FK_bef02bc9e1cbb88fa833a833adf" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_condition" ADD CONSTRAINT "FK_0e3377f6485501dc9ff279feaf4" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_egg" ADD CONSTRAINT "FK_3a3073a1170f2a407f52c8d2afd" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_equip" ADD CONSTRAINT "FK_95d97faa9656dc4b03d1e88b932" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_trick" ADD CONSTRAINT "FK_3c887f581353e7ac8ee16b30298" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pvp_rank" ADD CONSTRAINT "FK_e10be6e9424b99a43ed49fca15a" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pvp_rank" DROP CONSTRAINT "FK_e10be6e9424b99a43ed49fca15a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_trick" DROP CONSTRAINT "FK_3c887f581353e7ac8ee16b30298"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_equip" DROP CONSTRAINT "FK_95d97faa9656dc4b03d1e88b932"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_egg" DROP CONSTRAINT "FK_3a3073a1170f2a407f52c8d2afd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_condition" DROP CONSTRAINT "FK_0e3377f6485501dc9ff279feaf4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "minigame_session" DROP CONSTRAINT "FK_bef02bc9e1cbb88fa833a833adf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_progress" DROP CONSTRAINT "FK_7547dfd1acfd6903c69f2194d8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinic" DROP CONSTRAINT "FK_10cc3ad1543c70b0ac3d87892f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinic_case" DROP CONSTRAINT "FK_43a0a0eeaa04368af0582776483"`,
    );
  }
}
