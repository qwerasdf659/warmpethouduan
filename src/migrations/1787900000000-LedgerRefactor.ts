import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 账本与交易系统重构。
 *
 * 用 raw SQL 而非 `migration:generate`：本迁移里有三样东西 TypeORM 表达不了——
 * `asset_entry` 的按月分区、`asset_lot` 的 `NULLS NOT DISTINCT` 唯一索引、
 * 以及多列 CHECK 约束（合规红线）。实体只映射父表做只读查询。
 *
 * 项目未上线，因此直接建新删旧：`wallet` / `ledger` / `item_owned` / `item_def`
 * 在本迁移末尾被 DROP，`pet_equip` / `home_layout` 的 `item_def_id` 外键改为
 * `asset_code`（存量摆放与穿戴数据一并清空，它们引用的定义表已不存在）。
 */
export class LedgerRefactor1787900000000 implements MigrationInterface {
  name = 'LedgerRefactor1787900000000';

  public async up(q: QueryRunner): Promise<void> {
    // ------------------------------------------------------------ 账户
    await q.query(`
      CREATE TABLE "account" (
        "id"          BIGSERIAL   PRIMARY KEY,
        "kind"        varchar(8)  NOT NULL,
        "user_id"     bigint      NULL REFERENCES "user"("id"),
        "system_code" varchar(32) NULL,
        "status"      varchar(16) NOT NULL DEFAULT 'active',
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_account_kind" CHECK ("kind" IN ('user','system')),
        CONSTRAINT "ck_account_ref" CHECK (
          ("kind" = 'user'   AND "user_id" IS NOT NULL AND "system_code" IS NULL) OR
          ("kind" = 'system' AND "user_id" IS NULL     AND "system_code" IS NOT NULL)
        )
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX "uq_account_user" ON "account"("user_id") WHERE "user_id" IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_account_system" ON "account"("system_code") WHERE "system_code" IS NOT NULL`,
    );

    // ------------------------------------------------------------ 资产定义
    await q.query(`
      CREATE TABLE "asset_def" (
        "code"                 varchar(48) PRIMARY KEY,
        "kind"                 varchar(16) NOT NULL,
        "name"                 varchar(48) NOT NULL,
        "tradable"             boolean NOT NULL DEFAULT false,
        "redeemable"           boolean NOT NULL DEFAULT false,
        "gacha_output"         boolean NOT NULL DEFAULT false,
        "trade_cooldown_hours" int     NOT NULL DEFAULT 72,
        "expire_days"          int     NULL,
        "mint_limit"           int     NULL,
        "minted_count"         int     NOT NULL DEFAULT 0,
        "enabled"              boolean NOT NULL DEFAULT true,
        "sort_order"           int     NOT NULL DEFAULT 0,
        "meta"                 jsonb   NOT NULL DEFAULT '{}',
        "created_at"           timestamptz NOT NULL DEFAULT now(),
        "updated_at"           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_asset_kind" CHECK ("kind" IN ('currency','stackable','unique')),
        CONSTRAINT "ck_asset_no_trade_redeem" CHECK (NOT ("tradable" AND "redeemable")),
        CONSTRAINT "ck_asset_no_trade_gacha"  CHECK (NOT ("tradable" AND "gacha_output")),
        CONSTRAINT "ck_asset_expire_days" CHECK ("expire_days" IS NULL OR "expire_days" > 0),
        CONSTRAINT "ck_asset_mint_limit" CHECK ("mint_limit" IS NULL OR "minted_count" <= "mint_limit"),
        CONSTRAINT "ck_asset_cooldown" CHECK ("trade_cooldown_hours" >= 0)
      )
    `);
    // 目录按「表现层类型」筛选（换装/家具/消耗品），类型落在 meta 里
    await q.query(
      `CREATE INDEX "idx_asset_def_item_type" ON "asset_def"(("meta" ->> 'itemType'), "sort_order")`,
    );

    // ------------------------------------------------------------ 凭证头（幂等唯一权威）
    await q.query(`
      CREATE TABLE "asset_txn" (
        "id"          BIGSERIAL    PRIMARY KEY,
        "biz_id"      varchar(160) NOT NULL,
        "kind"        varchar(16)  NOT NULL,
        "reason"      varchar(32)  NOT NULL,
        "ref_type"    varchar(32)  NULL,
        "ref_id"      varchar(64)  NULL,
        "reversal_of" bigint       NULL REFERENCES "asset_txn"("id"),
        "created_at"  timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_asset_txn_biz_id" UNIQUE ("biz_id"),
        CONSTRAINT "ck_asset_txn_kind" CHECK ("kind" IN ('issue','burn','transfer','freeze','reversal'))
      )
    `);
    await q.query(
      `CREATE INDEX "idx_asset_txn_created" ON "asset_txn"("created_at")`,
    );
    await q.query(
      `CREATE INDEX "idx_asset_txn_reason" ON "asset_txn"("reason", "created_at")`,
    );

    // ------------------------------------------------------------ 分录（按月分区）
    //
    // 分区表的 PK 必须包含分区键，故 PK 是 (id, created_at)。分录上不设唯一约束——
    // 幂等已经收敛到 asset_txn.biz_id（非分区表，可全局唯一），凭证插入成功才写分录。
    await q.query(`
      CREATE TABLE "asset_entry" (
        "id"            BIGSERIAL,
        "txn_id"        bigint      NOT NULL REFERENCES "asset_txn"("id"),
        "account_id"    bigint      NOT NULL REFERENCES "account"("id"),
        "asset_code"    varchar(48) NOT NULL REFERENCES "asset_def"("code"),
        "delta"         bigint      NOT NULL DEFAULT 0,
        "frozen_delta"  bigint      NOT NULL DEFAULT 0,
        "balance_after" bigint      NOT NULL,
        "frozen_after"  bigint      NOT NULL,
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("id", "created_at"),
        CONSTRAINT "ck_entry_nonzero" CHECK ("delta" <> 0 OR "frozen_delta" <> 0)
      ) PARTITION BY RANGE ("created_at")
    `);
    await q.query(
      `CREATE INDEX "idx_entry_account" ON "asset_entry"("account_id", "asset_code", "created_at" DESC)`,
    );
    await q.query(`CREATE INDEX "idx_entry_txn" ON "asset_entry"("txn_id")`);

    // 预建当前月起 18 个月的分区；另有 PM2 月度作业持续补建（PartitionService）。
    await q.query(`
      DO $$
      DECLARE
        m date := date_trunc('month', now())::date;
        i int;
      BEGIN
        FOR i IN 0..17 LOOP
          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF "asset_entry" FOR VALUES FROM (%L) TO (%L)',
            'asset_entry_' || to_char(m + (i || ' month')::interval, 'YYYY_MM'),
            (m + (i || ' month')::interval)::date,
            (m + ((i + 1) || ' month')::interval)::date
          );
        END LOOP;
      END $$
    `);
    // 兜底分区：补建作业万一失败也绝不让记账写入报错（分录是资金主链路）。
    // 正常情况下它恒为空，月度作业据此把具体月份分区 ATTACH 进来。
    await q.query(
      `CREATE TABLE "asset_entry_default" PARTITION OF "asset_entry" DEFAULT`,
    );

    // ------------------------------------------------------------ 余额
    await q.query(`
      CREATE TABLE "asset_balance" (
        "account_id" bigint      NOT NULL REFERENCES "account"("id"),
        "asset_code" varchar(48) NOT NULL REFERENCES "asset_def"("code"),
        "available"  bigint      NOT NULL DEFAULT 0,
        "frozen"     bigint      NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("account_id", "asset_code"),
        CONSTRAINT "ck_balance_non_negative" CHECK ("available" >= 0 AND "frozen" >= 0)
      )
    `);

    // ------------------------------------------------------------ 批次（lot）与过期
    await q.query(`
      CREATE TABLE "asset_lot" (
        "id"           BIGSERIAL   PRIMARY KEY,
        "account_id"   bigint      NOT NULL REFERENCES "account"("id"),
        "asset_code"   varchar(48) NOT NULL REFERENCES "asset_def"("code"),
        "remaining"    bigint      NOT NULL DEFAULT 0,
        "frozen"       bigint      NOT NULL DEFAULT 0,
        "issued_total" bigint      NOT NULL DEFAULT 0,
        "expires_at"   timestamptz NULL,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_lot_non_negative" CHECK ("remaining" >= 0 AND "frozen" >= 0),
        CONSTRAINT "ck_lot_within_issued" CHECK ("remaining" + "frozen" <= "issued_total")
      )
    `);
    // NULLS NOT DISTINCT（PG15+）让「永不过期」的批次也受唯一约束覆盖，
    // 从而 ON CONFLICT 能命中它并归并为单行——这是批次方案的承重点。
    await q.query(`
      CREATE UNIQUE INDEX "uq_lot_bucket"
        ON "asset_lot"("account_id", "asset_code", "expires_at") NULLS NOT DISTINCT
    `);
    await q.query(`
      CREATE INDEX "idx_lot_fifo"
        ON "asset_lot"("account_id", "asset_code", "expires_at" NULLS LAST, "id")
        WHERE "remaining" > 0
    `);
    await q.query(`
      CREATE INDEX "idx_lot_expiring" ON "asset_lot"("expires_at")
        WHERE "expires_at" IS NOT NULL AND "remaining" > 0
    `);

    // ------------------------------------------------------------ 唯一物品实例
    await q.query(`
      CREATE TABLE "item_instance" (
        "id"               BIGSERIAL   PRIMARY KEY,
        "asset_code"       varchar(48) NOT NULL REFERENCES "asset_def"("code"),
        "owner_account_id" bigint      NOT NULL REFERENCES "account"("id"),
        "state"            varchar(16) NOT NULL DEFAULT 'held',
        "serial"           int         NULL,
        "acquired_at"      timestamptz NOT NULL DEFAULT now(),
        "tradable_after"   timestamptz NULL,
        "minted_txn_id"    bigint      NOT NULL REFERENCES "asset_txn"("id"),
        CONSTRAINT "ck_instance_state" CHECK ("state" IN ('held','listed','escrowed','burned'))
      )
    `);
    await q.query(
      `CREATE INDEX "idx_instance_owner" ON "item_instance"("owner_account_id", "asset_code")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_instance_serial" ON "item_instance"("asset_code", "serial") WHERE "serial" IS NOT NULL`,
    );

    await q.query(`
      CREATE TABLE "item_instance_entry" (
        "id"          BIGSERIAL   PRIMARY KEY,
        "txn_id"      bigint      NOT NULL REFERENCES "asset_txn"("id"),
        "instance_id" bigint      NOT NULL REFERENCES "item_instance"("id"),
        "account_id"  bigint      NOT NULL REFERENCES "account"("id"),
        "delta"       smallint    NOT NULL,
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_instance_entry_delta" CHECK ("delta" IN (-1, 1)),
        CONSTRAINT "uq_instance_entry" UNIQUE ("instance_id", "txn_id", "account_id")
      )
    `);
    await q.query(
      `CREATE INDEX "idx_instance_entry_instance" ON "item_instance_entry"("instance_id")`,
    );

    // ------------------------------------------------------------ 市场
    await q.query(`
      CREATE TABLE "market_listing" (
        "id"                BIGSERIAL   PRIMARY KEY,
        "seller_account_id" bigint      NOT NULL REFERENCES "account"("id"),
        "mode"              varchar(16) NOT NULL,
        "asset_code"        varchar(48) NOT NULL REFERENCES "asset_def"("code"),
        "qty"               bigint      NULL,
        "instance_id"       bigint      NULL REFERENCES "item_instance"("id"),
        "price_asset"       varchar(48) NOT NULL REFERENCES "asset_def"("code"),
        "price"             bigint      NOT NULL,
        "fee_bps"           int         NOT NULL,
        "status"            varchar(16) NOT NULL DEFAULT 'listed',
        "expires_at"        timestamptz NOT NULL,
        "created_txn_id"    bigint      NOT NULL REFERENCES "asset_txn"("id"),
        "settled_txn_id"    bigint      NULL REFERENCES "asset_txn"("id"),
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_listing_mode"   CHECK ("mode" IN ('fixed','auction')),
        CONSTRAINT "ck_listing_status" CHECK ("status" IN ('listed','sold','cancelled','expired')),
        CONSTRAINT "ck_listing_price"  CHECK ("price" > 0),
        CONSTRAINT "ck_listing_fee_bps" CHECK ("fee_bps" >= 0 AND "fee_bps" <= 10000),
        CONSTRAINT "ck_listing_subject" CHECK (
          ("qty" IS NOT NULL AND "qty" > 0 AND "instance_id" IS NULL) OR
          ("qty" IS NULL AND "instance_id" IS NOT NULL)
        )
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX "uq_listing_instance_active" ON "market_listing"("instance_id")
        WHERE "status" = 'listed' AND "instance_id" IS NOT NULL
    `);
    await q.query(
      `CREATE INDEX "idx_listing_browse" ON "market_listing"("asset_code", "status", "price")`,
    );
    await q.query(
      `CREATE INDEX "idx_listing_expire" ON "market_listing"("status", "expires_at")`,
    );
    await q.query(
      `CREATE INDEX "idx_listing_seller" ON "market_listing"("seller_account_id", "status")`,
    );

    await q.query(`
      CREATE TABLE "market_bid" (
        "id"                BIGSERIAL   PRIMARY KEY,
        "listing_id"        bigint      NOT NULL REFERENCES "market_listing"("id"),
        "bidder_account_id" bigint      NOT NULL REFERENCES "account"("id"),
        "price"             bigint      NOT NULL,
        "status"            varchar(16) NOT NULL DEFAULT 'active',
        "freeze_txn_id"     bigint      NOT NULL REFERENCES "asset_txn"("id"),
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_bid_status" CHECK ("status" IN ('active','outbid','won','cancelled')),
        CONSTRAINT "ck_bid_price" CHECK ("price" > 0)
      )
    `);
    await q.query(
      `CREATE INDEX "idx_bid_listing" ON "market_bid"("listing_id", "price" DESC, "created_at")`,
    );
    // 一个挂单上每个买家至多一条 active 出价（加价走「改价」而不是堆积多条）
    await q.query(`
      CREATE UNIQUE INDEX "uq_bid_active_bidder" ON "market_bid"("listing_id", "bidder_account_id")
        WHERE "status" = 'active'
    `);

    // ------------------------------------------------------------ 风控与统计
    await q.query(`
      CREATE TABLE "trade_risk_daily" (
        "account_id"  bigint NOT NULL REFERENCES "account"("id"),
        "stat_day"    date   NOT NULL,
        "trade_count" int    NOT NULL DEFAULT 0,
        "trade_value" bigint NOT NULL DEFAULT 0,
        "net_outflow" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("account_id", "stat_day")
      )
    `);

    await q.query(`
      CREATE TABLE "asset_daily_stat" (
        "stat_day"   date        NOT NULL,
        "asset_code" varchar(48) NOT NULL,
        "reason"     varchar(32) NOT NULL,
        "issued"     bigint      NOT NULL DEFAULT 0,
        "burned"     bigint      NOT NULL DEFAULT 0,
        PRIMARY KEY ("stat_day", "asset_code", "reason")
      )
    `);

    // ------------------------------------------------------------ 存量表改造
    //
    // pet_equip / home_layout 原先按 item_def.id 引用物品定义；新模型的资产身份是
    // asset_def.code。定义表即将被 DROP，存量行的引用无从解析，一并清空。
    await q.query(`DELETE FROM "pet_equip"`);
    await q.query(`DELETE FROM "home_layout"`);
    await q.query(`ALTER TABLE "pet_equip" DROP COLUMN "item_def_id"`);
    await q.query(
      `ALTER TABLE "pet_equip" ADD COLUMN "asset_code" varchar(48) NOT NULL`,
    );
    await q.query(`ALTER TABLE "home_layout" DROP COLUMN "item_def_id"`);
    await q.query(
      `ALTER TABLE "home_layout" ADD COLUMN "asset_code" varchar(48) NOT NULL`,
    );
    await q.query(
      `CREATE INDEX "idx_home_layout_asset" ON "home_layout"("user_id", "asset_code")`,
    );

    // ------------------------------------------------------------ 删旧
    await q.query(`DROP TABLE "ledger"`);
    await q.query(`DROP TABLE "wallet"`);
    await q.query(`DROP TABLE "item_owned"`);
    await q.query(`DROP TABLE "item_def"`);
  }

  /**
   * 不提供回滚。
   *
   * 唯一有意义的 down 是把 `wallet` / `ledger` / `item_owned` / `item_def`
   * 四张表重建出来，但**数据无法恢复**（up 已删），而且代码里早已没有任何实体、
   * 服务或查询引用它们——重建出来的是四张永远没人读、也没人写的空表。
   * 那种 down 给人「可以回滚」的错觉，实际回滚后应用起不来，比直接拒绝更危险。
   *
   * 需要回到重构前，正确做法是重建库并 checkout 到重构前的提交。
   */
  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        '账本重构不可回滚：旧表数据已删除，且代码已无任何消费方。请重建库并回退代码版本。',
      ),
    );
  }
}
