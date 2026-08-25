import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminRbac1787617731060 implements MigrationInterface {
  name = 'AdminRbac1787617731060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admin_permission" ("id" BIGSERIAL NOT NULL, "code" character varying(128) NOT NULL, "name" character varying(64) NOT NULL, "group_name" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9855e5c507c4422f88efd935c25" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_admin_permission_code" ON "admin_permission"  ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "admin_menu" ("id" BIGSERIAL NOT NULL, "parent_id" bigint, "name" character varying(64) NOT NULL, "type" character varying(16) NOT NULL DEFAULT 'menu', "path" character varying(255), "component" character varying(255), "icon" character varying(64), "permission_code" character varying(128), "sort_order" integer NOT NULL DEFAULT '0', "visible" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a1070d3dc06cf7d9fb54ec91a99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_admin_menu_parent_id" ON "admin_menu"  ("parent_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "admin_role" ("id" BIGSERIAL NOT NULL, "code" character varying(64) NOT NULL, "name" character varying(64) NOT NULL, "description" character varying(255), "is_system" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fd32421f2d93414e46a8fcfd86b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_admin_role_code" ON "admin_role"  ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "admin_user" ("id" BIGSERIAL NOT NULL, "username" character varying(64) NOT NULL, "password_hash" character varying(255) NOT NULL, "display_name" character varying(64), "status" character varying(16) NOT NULL DEFAULT 'active', "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a28028ba709cd7e5053a86857b4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_admin_user_username" ON "admin_user"  ("username") `,
    );
    await queryRunner.query(
      `CREATE TABLE "admin_audit_log" ("id" BIGSERIAL NOT NULL, "admin_user_id" bigint, "admin_username" character varying(64), "action" character varying(128), "method" character varying(8) NOT NULL, "path" character varying(255) NOT NULL, "target_type" character varying(64), "target_id" character varying(64), "biz_id" character varying(128), "ip" character varying(64), "user_agent" character varying(255), "request_body" jsonb, "status_code" integer NOT NULL, "success" boolean NOT NULL, "error_message" character varying(512), "duration_ms" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9425be48a9c753f5753017c61b2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_admin_audit_admin_user_id" ON "admin_audit_log"  ("admin_user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_admin_audit_created_at" ON "admin_audit_log"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "admin_role_permission" ("role_id" bigint NOT NULL, "permission_id" bigint NOT NULL, CONSTRAINT "PK_f3498f63c81b87ee256fdfe645c" PRIMARY KEY ("role_id", "permission_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e600b7572461a294169559a16" ON "admin_role_permission"  ("role_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b88acb4df45499101e19818915" ON "admin_role_permission"  ("permission_id") `,
    );
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
      `CREATE TABLE "admin_user_role" ("admin_user_id" bigint NOT NULL, "role_id" bigint NOT NULL, CONSTRAINT "PK_1e3f1cfc72dcaf25053a8fd77be" PRIMARY KEY ("admin_user_id", "role_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df8c115670cc92552bf5d3f36e" ON "admin_user_role"  ("admin_user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2755b4303706dda68d9fdbe2c9" ON "admin_user_role"  ("role_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_permission" ADD CONSTRAINT "FK_1e600b7572461a294169559a16c" FOREIGN KEY ("role_id") REFERENCES "admin_role"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_permission" ADD CONSTRAINT "FK_b88acb4df45499101e198189159" FOREIGN KEY ("permission_id") REFERENCES "admin_permission"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_menu" ADD CONSTRAINT "FK_edd4db9350d5cc0a4aa28886f9c" FOREIGN KEY ("role_id") REFERENCES "admin_role"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_menu" ADD CONSTRAINT "FK_e5ef83be2139a642a7bc4d679a4" FOREIGN KEY ("menu_id") REFERENCES "admin_menu"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_user_role" ADD CONSTRAINT "FK_df8c115670cc92552bf5d3f36e6" FOREIGN KEY ("admin_user_id") REFERENCES "admin_user"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_user_role" ADD CONSTRAINT "FK_2755b4303706dda68d9fdbe2c97" FOREIGN KEY ("role_id") REFERENCES "admin_role"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admin_user_role" DROP CONSTRAINT "FK_2755b4303706dda68d9fdbe2c97"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_user_role" DROP CONSTRAINT "FK_df8c115670cc92552bf5d3f36e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_menu" DROP CONSTRAINT "FK_e5ef83be2139a642a7bc4d679a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_menu" DROP CONSTRAINT "FK_edd4db9350d5cc0a4aa28886f9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_permission" DROP CONSTRAINT "FK_b88acb4df45499101e198189159"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_permission" DROP CONSTRAINT "FK_1e600b7572461a294169559a16c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2755b4303706dda68d9fdbe2c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df8c115670cc92552bf5d3f36e"`,
    );
    await queryRunner.query(`DROP TABLE "admin_user_role"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5ef83be2139a642a7bc4d679a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_edd4db9350d5cc0a4aa28886f9"`,
    );
    await queryRunner.query(`DROP TABLE "admin_role_menu"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b88acb4df45499101e19818915"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e600b7572461a294169559a16"`,
    );
    await queryRunner.query(`DROP TABLE "admin_role_permission"`);
    await queryRunner.query(`DROP INDEX "public"."idx_admin_audit_created_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_admin_audit_admin_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "admin_audit_log"`);
    await queryRunner.query(`DROP INDEX "public"."uq_admin_user_username"`);
    await queryRunner.query(`DROP TABLE "admin_user"`);
    await queryRunner.query(`DROP INDEX "public"."uq_admin_role_code"`);
    await queryRunner.query(`DROP TABLE "admin_role"`);
    await queryRunner.query(`DROP INDEX "public"."idx_admin_menu_parent_id"`);
    await queryRunner.query(`DROP TABLE "admin_menu"`);
    await queryRunner.query(`DROP INDEX "public"."uq_admin_permission_code"`);
    await queryRunner.query(`DROP TABLE "admin_permission"`);
  }
}
