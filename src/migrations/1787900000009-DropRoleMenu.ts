import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 删除 admin_role_menu —— 菜单授权的第二套（死）模型。
 *
 * 菜单可见性从来是由 `admin_menu.permission_code` 与角色权限集求交算出的
 * （AdminAccessService.resolveMenus），这张中间表虽有 CRUD 入口却从不参与鉴权，
 * 留着只会让人以为"授了菜单就能看"。真相源收敛到 permission_code 一处。
 */
export class DropRoleMenu1787900000009 implements MigrationInterface {
  name = 'DropRoleMenu1787900000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_role_menu"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admin_role_menu" ("role_id" bigint NOT NULL, "menu_id" bigint NOT NULL, CONSTRAINT "PK_020fd964bdc6a4d95b69bd21215" PRIMARY KEY ("role_id", "menu_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_edd4db9350d5cc0a4aa28886f9" ON "admin_role_menu"  ("role_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5ef83be2139a642a7bc4d679a" ON "admin_role_menu"  ("menu_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_menu" ADD CONSTRAINT "FK_edd4db9350d5cc0a4aa28886f9c" FOREIGN KEY ("role_id") REFERENCES "admin_role"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_menu" ADD CONSTRAINT "FK_e5ef83be2139a642a7bc4d679a4" FOREIGN KEY ("menu_id") REFERENCES "admin_menu"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }
}
