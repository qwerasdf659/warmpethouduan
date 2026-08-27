import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayExpansion1787839760464 implements MigrationInterface {
  name = 'PlayExpansion1787839760464';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "clinic_case" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "condition_key" character varying(32) NOT NULL, "symptoms" jsonb NOT NULL, "options" jsonb NOT NULL, "answer_key" character varying(32) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'open', "answered_key" character varying(32), "correct" boolean, "reward_coin" integer NOT NULL DEFAULT '0', "biz_id" character varying(128), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_10bf2bc12a55056bf7ca3b31be4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinic_case_user" ON "clinic_case"  ("user_id", "status", "expires_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "clinic" ("user_id" bigint NOT NULL, "unlocked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "star" integer NOT NULL DEFAULT '1', "correct_count" integer NOT NULL DEFAULT '0', "total_count" integer NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_10cc3ad1543c70b0ac3d87892f2" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "event_progress" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "event_key" character varying(48) NOT NULL, "task_key" character varying(48) NOT NULL, "progress" integer NOT NULL DEFAULT '0', "claimed_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_92f2c90879a1ec86435dec7a270" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_event_progress" ON "event_progress"  ("user_id", "event_key", "task_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "game_event" ("key" character varying(48) NOT NULL, "name" character varying(64) NOT NULL, "type" character varying(24) NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "banner" character varying(64), "payload" jsonb NOT NULL DEFAULT '{}', "enabled" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c7eef063460711db55a9b45533" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_game_event_window" ON "game_event"  ("enabled", "starts_at", "ends_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "home_like" ("id" BIGSERIAL NOT NULL, "from_user_id" bigint NOT NULL, "to_user_id" bigint NOT NULL, "like_day" character varying(10) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a0a021c451abd6ffd3671603dcc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_home_like_to" ON "home_like"  ("to_user_id", "like_day") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_home_like_daily" ON "home_like"  ("from_user_id", "to_user_id", "like_day") `,
    );
    await queryRunner.query(
      `CREATE TABLE "minigame_session" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "game_key" character varying(32) NOT NULL, "seed" character varying(64) NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'open', "score" integer, "reward_coin" integer NOT NULL DEFAULT '0', "biz_id" character varying(128) NOT NULL, "settled_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f54f99100962a476050acdaf6af" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_minigame_user" ON "minigame_session"  ("user_id", "status", "expires_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_minigame_biz" ON "minigame_session"  ("user_id", "biz_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pet_condition" ("id" BIGSERIAL NOT NULL, "pet_id" bigint NOT NULL, "user_id" bigint NOT NULL, "condition_key" character varying(32) NOT NULL, "since" TIMESTAMP WITH TIME ZONE NOT NULL, "cured_at" TIMESTAMP WITH TIME ZONE, "cured_by" character varying(16), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fa91c0b4cf6a09e7d5fd3d0e54a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pet_condition_user" ON "pet_condition"  ("user_id", "cured_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_condition_active" ON "pet_condition"  ("pet_id", "condition_key") WHERE cured_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "pet_egg" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "parent_a_id" bigint NOT NULL, "parent_b_id" bigint NOT NULL, "species" character varying(32) NOT NULL, "genes" jsonb NOT NULL DEFAULT '[]', "traits" jsonb NOT NULL DEFAULT '[]', "stamina_bonus_bps" integer NOT NULL DEFAULT '0', "hatch_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'incubating', "hatched_pet_id" bigint, "biz_id" character varying(128) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_702d826563362da1ac05244dd58" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pet_egg_user" ON "pet_egg"  ("user_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_egg_biz" ON "pet_egg"  ("user_id", "biz_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pet_trick" ("id" BIGSERIAL NOT NULL, "pet_id" bigint NOT NULL, "user_id" bigint NOT NULL, "trick_key" character varying(32) NOT NULL, "proficiency" integer NOT NULL DEFAULT '0', "learned_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_practice_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f281e16c4ace300644c45e16fc9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pet_trick_user" ON "pet_trick"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_trick" ON "pet_trick"  ("pet_id", "trick_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pvp_match" ("id" BIGSERIAL NOT NULL, "season" character varying(16) NOT NULL, "challenger_user_id" bigint NOT NULL, "opponent_user_id" bigint NOT NULL, "track_key" character varying(32) NOT NULL, "challenger_time" numeric(6,2) NOT NULL, "opponent_time" numeric(6,2) NOT NULL, "win" boolean NOT NULL, "rank_point_delta" integer NOT NULL, "reward_coin" integer NOT NULL DEFAULT '0', "opponent_snapshot" jsonb NOT NULL, "biz_id" character varying(128) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8fc4e30b312f7dfb07a63fa957a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pvp_match_theirs" ON "pvp_match"  ("opponent_user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pvp_match_mine" ON "pvp_match"  ("challenger_user_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pvp_match_biz" ON "pvp_match"  ("challenger_user_id", "biz_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pvp_rank" ("user_id" bigint NOT NULL, "season" character varying(16) NOT NULL, "rank_point" integer NOT NULL DEFAULT '1000', "wins" integer NOT NULL DEFAULT '0', "losses" integer NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e10be6e9424b99a43ed49fca15a" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pvp_rank_board" ON "pvp_rank"  ("season", "rank_point", "updated_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "trade_offer_item" ("id" BIGSERIAL NOT NULL, "offer_id" bigint NOT NULL, "side" character varying(8) NOT NULL, "asset_code" character varying(48), "qty" bigint, "instance_id" bigint, CONSTRAINT "PK_9113af884c0aade545891cb360a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trade_offer_item_offer" ON "trade_offer_item"  ("offer_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "trade_offer" ("id" BIGSERIAL NOT NULL, "from_user_id" bigint NOT NULL, "to_user_id" bigint NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "from_coin" bigint NOT NULL DEFAULT '0', "to_coin" bigint NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "biz_id" character varying(128) NOT NULL, "settled_txn_id" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b6c553463560880da2a3e04e95e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trade_offer_from" ON "trade_offer"  ("from_user_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trade_offer_to" ON "trade_offer"  ("to_user_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_trade_offer_biz" ON "trade_offer"  ("from_user_id", "biz_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "traits" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "genes" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "breed_cooldown_until" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "form" character varying(16) NOT NULL DEFAULT 'normal'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "rarity" character varying(16) NOT NULL DEFAULT 'common'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "status" character varying(16) NOT NULL DEFAULT 'active'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pet" ADD "play_count" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pet_active_status" ON "pet"  ("user_id") WHERE status = 'active'`,
    );
    // P8：出战宠唯一索引纳入 status，已融合（fused）的幽灵宠不占出战唯一位。
    // TypeORM 不比对部分索引的 WHERE 子句，故手工重建（未来 generate 不会回退它）。
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_pet_active_per_user"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_active_per_user" ON "pet" ("user_id") WHERE (is_active = true AND status = 'active')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_pet_active_per_user"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pet_active_per_user" ON "pet" ("user_id") WHERE (is_active = true)`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_pet_active_status"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "play_count"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "status"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "rarity"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "form"`);
    await queryRunner.query(
      `ALTER TABLE "pet" DROP COLUMN "breed_cooldown_until"`,
    );
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "genes"`);
    await queryRunner.query(`ALTER TABLE "pet" DROP COLUMN "traits"`);
    await queryRunner.query(`DROP INDEX "public"."uq_trade_offer_biz"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trade_offer_to"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trade_offer_from"`);
    await queryRunner.query(`DROP TABLE "trade_offer"`);
    await queryRunner.query(`DROP INDEX "public"."idx_trade_offer_item_offer"`);
    await queryRunner.query(`DROP TABLE "trade_offer_item"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pvp_rank_board"`);
    await queryRunner.query(`DROP TABLE "pvp_rank"`);
    await queryRunner.query(`DROP INDEX "public"."uq_pvp_match_biz"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pvp_match_mine"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pvp_match_theirs"`);
    await queryRunner.query(`DROP TABLE "pvp_match"`);
    await queryRunner.query(`DROP INDEX "public"."uq_pet_trick"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pet_trick_user"`);
    await queryRunner.query(`DROP TABLE "pet_trick"`);
    await queryRunner.query(`DROP INDEX "public"."uq_pet_egg_biz"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pet_egg_user"`);
    await queryRunner.query(`DROP TABLE "pet_egg"`);
    await queryRunner.query(`DROP INDEX "public"."uq_pet_condition_active"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pet_condition_user"`);
    await queryRunner.query(`DROP TABLE "pet_condition"`);
    await queryRunner.query(`DROP INDEX "public"."uq_minigame_biz"`);
    await queryRunner.query(`DROP INDEX "public"."idx_minigame_user"`);
    await queryRunner.query(`DROP TABLE "minigame_session"`);
    await queryRunner.query(`DROP INDEX "public"."uq_home_like_daily"`);
    await queryRunner.query(`DROP INDEX "public"."idx_home_like_to"`);
    await queryRunner.query(`DROP TABLE "home_like"`);
    await queryRunner.query(`DROP INDEX "public"."idx_game_event_window"`);
    await queryRunner.query(`DROP TABLE "game_event"`);
    await queryRunner.query(`DROP INDEX "public"."uq_event_progress"`);
    await queryRunner.query(`DROP TABLE "event_progress"`);
    await queryRunner.query(`DROP TABLE "clinic"`);
    await queryRunner.query(`DROP INDEX "public"."idx_clinic_case_user"`);
    await queryRunner.query(`DROP TABLE "clinic_case"`);
  }
}
