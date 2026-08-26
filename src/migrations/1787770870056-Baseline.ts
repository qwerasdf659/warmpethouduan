import { MigrationInterface, QueryRunner } from 'typeorm';

export class Baseline1787770870056 implements MigrationInterface {
  name = 'Baseline1787770870056';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
      `CREATE TABLE "admin_menu" ("id" BIGSERIAL NOT NULL, "parent_id" bigint, "name" character varying(64) NOT NULL, "type" character varying(16) NOT NULL DEFAULT 'menu', "path" character varying(255), "component" character varying(255), "icon" character varying(64), "permission_code" character varying(128), "sort_order" integer NOT NULL DEFAULT '0', "visible" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a1070d3dc06cf7d9fb54ec91a99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_admin_menu_parent_id" ON "admin_menu"  ("parent_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "admin_permission" ("id" BIGSERIAL NOT NULL, "code" character varying(128) NOT NULL, "name" character varying(64) NOT NULL, "group_name" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9855e5c507c4422f88efd935c25" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_admin_permission_code" ON "admin_permission"  ("code") `,
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
      `CREATE TABLE "user" ("id" BIGSERIAL NOT NULL, "unionid" character varying(64), "openid" character varying(64) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'active', "banned_reason" character varying(255), "banned_at" TIMESTAMP WITH TIME ZONE, "last_seen_at" TIMESTAMP WITH TIME ZONE, "offline_base_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_unionid" ON "user"  ("unionid") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_openid" ON "user"  ("openid") `,
    );
    await queryRunner.query(
      `CREATE TABLE "daily" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "last_checkin_day" character varying(8), "streak" integer NOT NULL DEFAULT '0', "total_checkins" integer NOT NULL DEFAULT '0', "task_day" character varying(8), "claimed_tasks" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2f5e6c9d57ae96fad69b6f97bd5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_daily_user_id" ON "daily"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "dex_claim" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "entry_key" character varying(48) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3e6fe51fcc9a1184c73b7314f19" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_dex_claim_user_entry" ON "dex_claim"  ("user_id", "entry_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "gacha_draw" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pool_key" character varying(48) NOT NULL, "biz_id" character varying(128) NOT NULL, "times" integer NOT NULL, "cost" integer NOT NULL, "pool" character varying(16) NOT NULL, "prizes" jsonb NOT NULL, "delivered" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f753a0a2f37965b560f76509870" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_gacha_draw_user_id" ON "gacha_draw"  ("user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_gacha_draw_user_biz" ON "gacha_draw"  ("user_id", "biz_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "gacha_state" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pool_key" character varying(48) NOT NULL, "pity" integer NOT NULL DEFAULT '0', "total_draws" integer NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_82e33f882a6978f1399b361ff90" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_gacha_state_user_pool" ON "gacha_state"  ("user_id", "pool_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "game_config" ("id" BIGSERIAL NOT NULL, "key" character varying(64) NOT NULL, "description" character varying(128) NOT NULL DEFAULT '', "value" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6572e2a84c4c5d72a9227e0b894" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_game_config_key" ON "game_config"  ("key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "home_layout" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "item_def_id" bigint NOT NULL, "pos_x" integer NOT NULL DEFAULT '0', "pos_y" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a468bc5ba466b37be32eb30167e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_home_layout_user" ON "home_layout"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "item_def" ("id" BIGSERIAL NOT NULL, "key" character varying(48) NOT NULL, "type" character varying(16) NOT NULL, "name" character varying(48) NOT NULL, "slot" character varying(24), "price" integer NOT NULL DEFAULT '0', "pool" character varying(16) NOT NULL DEFAULT 'game', "comfort" integer NOT NULL DEFAULT '0', "grid_w" integer NOT NULL DEFAULT '1', "grid_h" integer NOT NULL DEFAULT '1', "meta" jsonb NOT NULL DEFAULT '{}', "enabled" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2e42b1c6dc6ea328768c3a58377" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_item_def_key" ON "item_def"  ("key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "item_owned" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "item_def_id" bigint NOT NULL, "qty" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e61d9fcd86b5826709ee4b77afc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_item_owned_user_item" ON "item_owned"  ("user_id", "item_def_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pool" character varying(16) NOT NULL, "delta" bigint NOT NULL, "balance_after" bigint NOT NULL, "biz_id" character varying(128) NOT NULL, "reason" character varying(32) NOT NULL, "ref_id" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_ledger_delta_nonzero" CHECK ("delta" <> 0), CONSTRAINT "ck_ledger_pool" CHECK ("pool" IN ('game','marketing')), CONSTRAINT "PK_7a322e9157e5f42a16750ba2a20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ledger_user_id_id" ON "ledger"  ("user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ledger_user_biz_pool" ON "ledger"  ("user_id", "biz_id", "pool") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pet" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "nickname" character varying(32), "species" character varying(32) NOT NULL DEFAULT 'default', "is_active" boolean NOT NULL DEFAULT true, "hunger" integer NOT NULL DEFAULT '80', "mood" integer NOT NULL DEFAULT '80', "cleanliness" integer NOT NULL DEFAULT '80', "stamina" integer NOT NULL DEFAULT '100', "intimacy" integer NOT NULL DEFAULT '0', "level" integer NOT NULL DEFAULT '1', "exp" integer NOT NULL DEFAULT '0', "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b1ac2e88e89b9480e0c5b53fa60" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pet_user_id" ON "pet"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_active_per_user" ON "pet"  ("user_id") WHERE is_active = true`,
    );
    await queryRunner.query(
      `CREATE TABLE "pet_equip" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "pet_id" bigint NOT NULL, "slot" character varying(24) NOT NULL, "item_def_id" bigint NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b32e425056fe205fd0c0989711e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_equip_pet_slot" ON "pet_equip"  ("pet_id", "slot") `,
    );
    await queryRunner.query(
      `CREATE TABLE "promo_code" ("id" BIGSERIAL NOT NULL, "code" character varying(32) NOT NULL, "batch" character varying(48) NOT NULL, "pool" character varying(16) NOT NULL, "amount" integer NOT NULL, "max_uses" integer NOT NULL DEFAULT '1', "used_count" integer NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE, "enabled" boolean NOT NULL DEFAULT true, "remark" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_promo_code_uses" CHECK ("max_uses" > 0 AND "used_count" >= 0), CONSTRAINT "ck_promo_code_pool" CHECK ("pool" IN ('game','marketing')), CONSTRAINT "ck_promo_code_amount" CHECK ("amount" > 0), CONSTRAINT "PK_ded0af550884c7ab3e345e76d73" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_promo_code_code" ON "promo_code"  ("code") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_promo_code_batch" ON "promo_code"  ("batch") `,
    );
    await queryRunner.query(
      `CREATE TABLE "promo_redemption" ("id" BIGSERIAL NOT NULL, "code_id" bigint NOT NULL, "user_id" bigint NOT NULL, "code" character varying(32) NOT NULL, "pool" character varying(16) NOT NULL, "amount" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_50eb74e71de2ff0f14720033736" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_promo_redemption_user_id" ON "promo_redemption"  ("user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_promo_redemption_code_user" ON "promo_redemption"  ("code_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "race_record" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "biz_id" character varying(128), "pet_id" bigint NOT NULL, "track_key" character varying(32) NOT NULL, "pet_level" integer NOT NULL, "score" integer NOT NULL, "finish_time" numeric(10,3), "grade" character varying(2), "ghost_source" character varying(8), "rank" integer NOT NULL, "total_racers" integer NOT NULL, "reward_coin" integer NOT NULL DEFAULT '0', "stamina_cost" integer NOT NULL DEFAULT '0', "status" character varying(16) NOT NULL DEFAULT 'pending', "reward_doubled" boolean NOT NULL DEFAULT false, "revive_count" integer NOT NULL DEFAULT '0', "settled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_10284084d4f1ca58adcc18649c1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_race_record_user_biz" ON "race_record"  ("user_id", "biz_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_race_ghost_sample" ON "race_record"  ("track_key", "pet_level", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_race_user_id_id" ON "race_record"  ("user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "redeem_order" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "exchange_key" character varying(48) NOT NULL, "item_name" character varying(64) NOT NULL, "item_type" character varying(16) NOT NULL, "cost" integer NOT NULL, "pool" character varying(16) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "biz_id" character varying(128) NOT NULL, "address" jsonb, "tracking_no" character varying(64), "shipped_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "remark" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_70e651a21471ce8faabbb159afd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_redeem_order_user_key_status" ON "redeem_order"  ("user_id", "exchange_key", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_redeem_order_key_status" ON "redeem_order"  ("exchange_key", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_redeem_status_id" ON "redeem_order"  ("status", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_redeem_user_biz" ON "redeem_order"  ("user_id", "biz_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_address" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "receiver" character varying(32) NOT NULL, "phone" character varying(20) NOT NULL, "region" character varying(128) NOT NULL, "detail" character varying(255) NOT NULL, "is_default" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_302d96673413455481d5ff4022a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_address_user" ON "user_address"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "wallet" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "game_coin" bigint NOT NULL DEFAULT '0', "marketing_point" bigint NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_wallet_non_negative" CHECK ("game_coin" >= 0 AND "marketing_point" >= 0), CONSTRAINT "PK_bec464dd8d54c39c54fd32e2334" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wallet_user_id" ON "wallet"  ("user_id") `,
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
      `CREATE TABLE "admin_user_role" ("admin_user_id" bigint NOT NULL, "role_id" bigint NOT NULL, CONSTRAINT "PK_1e3f1cfc72dcaf25053a8fd77be" PRIMARY KEY ("admin_user_id", "role_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df8c115670cc92552bf5d3f36e" ON "admin_user_role"  ("admin_user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2755b4303706dda68d9fdbe2c9" ON "admin_user_role"  ("role_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" ADD CONSTRAINT "FK_25e35cb9536505aa9646c761f8b" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "dex_claim" ADD CONSTRAINT "FK_9958de4163849bbc8435beb4e27" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gacha_draw" ADD CONSTRAINT "FK_dd42eca4c0457ee9564d55cb00f" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "gacha_state" ADD CONSTRAINT "FK_0a6a7eaf7f518dba873c28768bc" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_layout" ADD CONSTRAINT "FK_613be8cbae47640020ccfb08d77" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_owned" ADD CONSTRAINT "FK_948b1e531b87c90c120971fd776" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger" ADD CONSTRAINT "FK_f010927e851c0368a15c587f89a" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD CONSTRAINT "FK_64704296b7bd17e90ca0a620a98" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_equip" ADD CONSTRAINT "FK_3d14a2cdc6ad815a88cc03993fd" FOREIGN KEY ("pet_id") REFERENCES "pet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "promo_redemption" ADD CONSTRAINT "FK_018ff8b7ff44a91868b457f62ac" FOREIGN KEY ("code_id") REFERENCES "promo_code"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "promo_redemption" ADD CONSTRAINT "FK_247449961248b17630591784161" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "race_record" ADD CONSTRAINT "FK_e003c328c682f30cdb896bb0b48" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "redeem_order" ADD CONSTRAINT "FK_030ce95499f0fa1b4195ca59c1b" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_address" ADD CONSTRAINT "FK_29d6df815a78e4c8291d3cf5e53" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" ADD CONSTRAINT "FK_72548a47ac4a996cd254b082522" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_permission" ADD CONSTRAINT "FK_1e600b7572461a294169559a16c" FOREIGN KEY ("role_id") REFERENCES "admin_role"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_permission" ADD CONSTRAINT "FK_b88acb4df45499101e198189159" FOREIGN KEY ("permission_id") REFERENCES "admin_permission"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
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
      `ALTER TABLE "admin_role_permission" DROP CONSTRAINT "FK_b88acb4df45499101e198189159"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_role_permission" DROP CONSTRAINT "FK_1e600b7572461a294169559a16c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet" DROP CONSTRAINT "FK_72548a47ac4a996cd254b082522"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_address" DROP CONSTRAINT "FK_29d6df815a78e4c8291d3cf5e53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "redeem_order" DROP CONSTRAINT "FK_030ce95499f0fa1b4195ca59c1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "race_record" DROP CONSTRAINT "FK_e003c328c682f30cdb896bb0b48"`,
    );
    await queryRunner.query(
      `ALTER TABLE "promo_redemption" DROP CONSTRAINT "FK_247449961248b17630591784161"`,
    );
    await queryRunner.query(
      `ALTER TABLE "promo_redemption" DROP CONSTRAINT "FK_018ff8b7ff44a91868b457f62ac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet_equip" DROP CONSTRAINT "FK_3d14a2cdc6ad815a88cc03993fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" DROP CONSTRAINT "FK_64704296b7bd17e90ca0a620a98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger" DROP CONSTRAINT "FK_f010927e851c0368a15c587f89a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_owned" DROP CONSTRAINT "FK_948b1e531b87c90c120971fd776"`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_layout" DROP CONSTRAINT "FK_613be8cbae47640020ccfb08d77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gacha_state" DROP CONSTRAINT "FK_0a6a7eaf7f518dba873c28768bc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gacha_draw" DROP CONSTRAINT "FK_dd42eca4c0457ee9564d55cb00f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dex_claim" DROP CONSTRAINT "FK_9958de4163849bbc8435beb4e27"`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily" DROP CONSTRAINT "FK_25e35cb9536505aa9646c761f8b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2755b4303706dda68d9fdbe2c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df8c115670cc92552bf5d3f36e"`,
    );
    await queryRunner.query(`DROP TABLE "admin_user_role"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b88acb4df45499101e19818915"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e600b7572461a294169559a16"`,
    );
    await queryRunner.query(`DROP TABLE "admin_role_permission"`);
    await queryRunner.query(`DROP INDEX "public"."uq_wallet_user_id"`);
    await queryRunner.query(`DROP TABLE "wallet"`);
    await queryRunner.query(`DROP INDEX "public"."idx_user_address_user"`);
    await queryRunner.query(`DROP TABLE "user_address"`);
    await queryRunner.query(`DROP INDEX "public"."uq_redeem_user_biz"`);
    await queryRunner.query(`DROP INDEX "public"."idx_redeem_status_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_redeem_order_key_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_redeem_order_user_key_status"`,
    );
    await queryRunner.query(`DROP TABLE "redeem_order"`);
    await queryRunner.query(`DROP INDEX "public"."idx_race_user_id_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_race_ghost_sample"`);
    await queryRunner.query(`DROP INDEX "public"."uq_race_record_user_biz"`);
    await queryRunner.query(`DROP TABLE "race_record"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_promo_redemption_code_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_promo_redemption_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "promo_redemption"`);
    await queryRunner.query(`DROP INDEX "public"."idx_promo_code_batch"`);
    await queryRunner.query(`DROP INDEX "public"."uq_promo_code_code"`);
    await queryRunner.query(`DROP TABLE "promo_code"`);
    await queryRunner.query(`DROP INDEX "public"."uq_pet_equip_pet_slot"`);
    await queryRunner.query(`DROP TABLE "pet_equip"`);
    await queryRunner.query(`DROP INDEX "public"."uq_pet_active_per_user"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pet_user_id"`);
    await queryRunner.query(`DROP TABLE "pet"`);
    await queryRunner.query(`DROP INDEX "public"."uq_ledger_user_biz_pool"`);
    await queryRunner.query(`DROP INDEX "public"."idx_ledger_user_id_id"`);
    await queryRunner.query(`DROP TABLE "ledger"`);
    await queryRunner.query(`DROP INDEX "public"."uq_item_owned_user_item"`);
    await queryRunner.query(`DROP TABLE "item_owned"`);
    await queryRunner.query(`DROP INDEX "public"."uq_item_def_key"`);
    await queryRunner.query(`DROP TABLE "item_def"`);
    await queryRunner.query(`DROP INDEX "public"."idx_home_layout_user"`);
    await queryRunner.query(`DROP TABLE "home_layout"`);
    await queryRunner.query(`DROP INDEX "public"."uq_game_config_key"`);
    await queryRunner.query(`DROP TABLE "game_config"`);
    await queryRunner.query(`DROP INDEX "public"."uq_gacha_state_user_pool"`);
    await queryRunner.query(`DROP TABLE "gacha_state"`);
    await queryRunner.query(`DROP INDEX "public"."uq_gacha_draw_user_biz"`);
    await queryRunner.query(`DROP INDEX "public"."idx_gacha_draw_user_id"`);
    await queryRunner.query(`DROP TABLE "gacha_draw"`);
    await queryRunner.query(`DROP INDEX "public"."uq_dex_claim_user_entry"`);
    await queryRunner.query(`DROP TABLE "dex_claim"`);
    await queryRunner.query(`DROP INDEX "public"."uq_daily_user_id"`);
    await queryRunner.query(`DROP TABLE "daily"`);
    await queryRunner.query(`DROP INDEX "public"."uq_user_openid"`);
    await queryRunner.query(`DROP INDEX "public"."uq_user_unionid"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP INDEX "public"."uq_admin_user_username"`);
    await queryRunner.query(`DROP TABLE "admin_user"`);
    await queryRunner.query(`DROP INDEX "public"."uq_admin_role_code"`);
    await queryRunner.query(`DROP TABLE "admin_role"`);
    await queryRunner.query(`DROP INDEX "public"."uq_admin_permission_code"`);
    await queryRunner.query(`DROP TABLE "admin_permission"`);
    await queryRunner.query(`DROP INDEX "public"."idx_admin_menu_parent_id"`);
    await queryRunner.query(`DROP TABLE "admin_menu"`);
    await queryRunner.query(`DROP INDEX "public"."idx_admin_audit_created_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_admin_audit_admin_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "admin_audit_log"`);
  }
}
