import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { rowsOf } from '../common/db/query-result';
import { MARKETING_POINT } from '../ledger/ledger.types';

/** 一条不变量的校验结果。`samples` 只留前若干条，日志与后台都不需要全量。 */
export interface InvariantResult {
  /** 不变量编号，与架构设计 §2.1 一一对应 */
  id: number;
  name: string;
  ok: boolean;
  /** 违反条数 */
  count: number;
  samples: Record<string, unknown>[];
}

export interface LiabilityReport {
  assetCode: string;
  /** 累计发行 */
  issued: number;
  /** 累计兑付（销毁） */
  burned: number;
  /** 待兑付负债 = 发行 − 兑付 */
  outstanding: number;
}

export interface ReconcileReport {
  checkedAt: string;
  accountCount: number;
  invariants: InvariantResult[];
  /** `marketing_point` 等可兑资产的待兑付负债 */
  liabilities: LiabilityReport[];
  /** 本次物化的 `asset_daily_stat` 行数 */
  statRowsMaterialized: number;
  ok: boolean;
}

/** 每条不变量最多留几条样本进报告。 */
const SAMPLE_LIMIT = 20;

/**
 * 每日对账：逐条校验架构设计 §2.1 的 11 项不变量，并物化发行/销毁日报。
 *
 * 为什么需要：正常代码路径不会漂移 —— 全项目对 `asset_balance` / `asset_lot` /
 * `item_instance` 的写入只出现在 `LedgerService` 一处、且都在同一事务里。真正的
 * 风险是**手工 SQL 改数据不补分录**，而这恰恰是排障、补偿、压测时最容易做的操作，
 * 数据库层没有任何约束能拦住它。
 *
 * 本作业**只读不写账**（只写 `asset_daily_stat` 这张纯统计表）：发现问题打 ERROR
 * 日志给运维，不自动纠账 —— 自动纠账会把证据也一起改掉。人工修复必须走冲正凭证
 * （`LedgerService.reverse`），留痕可查。
 *
 * 刻意**不提供**「从流水重算余额」的一键修复工具：那类工具会忽略 `frozen` 与批次
 * 分桶，把带冻结的账户改错，修复工具本身成为故障源。
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger('Reconcile');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly lock: LockService,
    private readonly clock: ClockService,
  ) {}

  /**
   * 每天 04:10（业务时区）跑一次，晚于 04:00 的过期作业 —— 顺序不能反：
   * 不变量 10 校验「不存在已过期但仍有余量的批次」，若对账先跑，
   * 它每天都会把当天该过期的批次报成异常。
   *
   * 单实例守卫：PM2 cluster 模式下每个 worker 都会加载本类，若不守卫会 N 份重复跑。
   * `NODE_APP_INSTANCE` 由 PM2 注入（fork 模式下为空，视为 0 号）。
   * 多机部署时环境变量不够用，所以再叠一把 Redis 锁兜底。
   */
  @Cron('10 4 * * *', { name: 'daily-reconcile', timeZone: 'Asia/Shanghai' })
  async daily(): Promise<void> {
    if ((process.env.NODE_APP_INSTANCE ?? '0') !== '0') return;

    await this.lock.withLock(
      'reconcile:daily',
      async () => {
        const report = await this.run();
        if (report.ok) {
          this.logger.log(
            `对账通过：${report.accountCount} 个账户、11 项不变量全部成立` +
              `（物化统计 ${report.statRowsMaterialized} 行）`,
          );
        } else {
          const broken = report.invariants.filter((i) => !i.ok);
          this.logger.error(
            `对账发现异常：${broken.length} 项不变量被违反 —— ` +
              broken.map((b) => `#${b.id} ${b.name}(${b.count})`).join('、'),
          );
          for (const b of broken) {
            for (const s of b.samples) {
              this.logger.error(`  #${b.id} ${JSON.stringify(s)}`);
            }
          }
        }
        for (const l of report.liabilities) {
          this.logger.log(
            `待兑付负债 ${l.assetCode}：发行 ${l.issued} − 兑付 ${l.burned} = ${l.outstanding}`,
          );
        }
      },
      // 抢不到锁说明别处正在跑，直接放弃本轮而不是排队等
      { ttlMs: 900_000, retries: 0 },
    );
  }

  /** 立即执行一次对账（后台「立即对账」按钮与定时作业共用）。 */
  async run(): Promise<ReconcileReport> {
    const invariants: InvariantResult[] = [];

    // ---- 不变量 1：转移凭证内部平衡（能定位到具体凭证）
    //
    // 求和口径是 `delta + frozen_delta` 而非只看 `delta`：竞价中标结算时买家出的是
    // 冻结中的钱（frozen_delta = −1000、delta = 0），卖家收到的是可用余额。
    // 只看 delta 会把这张完全平衡的凭证误报成差 1000。
    invariants.push(
      await this.check(
        1,
        '转移凭证按资产求和为 0',
        `SELECT e."txn_id", e."asset_code",
                SUM(e."delta" + e."frozen_delta") AS imbalance
           FROM "asset_entry" e JOIN "asset_txn" t ON t."id" = e."txn_id"
          WHERE t."kind" = 'transfer'
          GROUP BY 1, 2 HAVING SUM(e."delta" + e."frozen_delta") <> 0`,
      ),
    );

    // ---- 不变量 2：可用余额快照 == 分录 delta 累加
    invariants.push(
      await this.check(
        2,
        'asset_balance.available == SUM(asset_entry.delta)',
        `SELECT b."account_id", b."asset_code", b."available",
                COALESCE(s."d", 0) AS derived
           FROM "asset_balance" b
           LEFT JOIN (
             SELECT "account_id", "asset_code", SUM("delta") AS d
               FROM "asset_entry" GROUP BY 1, 2
           ) s ON s."account_id" = b."account_id" AND s."asset_code" = b."asset_code"
          WHERE b."available" <> COALESCE(s."d", 0)`,
      ),
    );

    // ---- 不变量 3：冻结余额快照 == 分录 frozen_delta 累加
    invariants.push(
      await this.check(
        3,
        'asset_balance.frozen == SUM(asset_entry.frozen_delta)',
        `SELECT b."account_id", b."asset_code", b."frozen",
                COALESCE(s."f", 0) AS derived
           FROM "asset_balance" b
           LEFT JOIN (
             SELECT "account_id", "asset_code", SUM("frozen_delta") AS f
               FROM "asset_entry" GROUP BY 1, 2
           ) s ON s."account_id" = b."account_id" AND s."asset_code" = b."asset_code"
          WHERE b."frozen" <> COALESCE(s."f", 0)`,
      ),
    );

    // ---- 不变量 4：余额非负（DB CHECK 已兜底，此处防有人手工禁用约束）
    invariants.push(
      await this.check(
        4,
        '余额非负',
        `SELECT "account_id", "asset_code", "available", "frozen"
           FROM "asset_balance" WHERE "available" < 0 OR "frozen" < 0`,
      ),
    );

    // ---- 不变量 5：每个实例存在且仅属一人（或已销毁）
    //
    // 求和为 1 = 在某人名下；为 0 = 已销毁（系统回收）。两者必须与 `state` 一致：
    // 求和 0 却不是 `burned`，意味着有一条转出分录没配对手方 —— 物品凭空消失；
    // 反过来 `burned` 却求和 1，意味着销毁只改了状态没写分录 —— 物品仍在流通盘里。
    invariants.push(
      await this.check(
        5,
        'item_instance 分录求和 ∈ {0,1} 且与 state 一致',
        `SELECT i."id" AS instance_id, i."asset_code", i."state",
                COALESCE(SUM(e."delta"), 0) AS owned
           FROM "item_instance" i
           LEFT JOIN "item_instance_entry" e ON e."instance_id" = i."id"
          GROUP BY i."id", i."asset_code", i."state"
         HAVING COALESCE(SUM(e."delta"), 0) NOT IN (0, 1)
             OR (COALESCE(SUM(e."delta"), 0) = 0 AND i."state" <> 'burned')
             OR (COALESCE(SUM(e."delta"), 0) = 1 AND i."state"  = 'burned')`,
      ),
    );

    // ---- 不变量 6：owner 缓存未漂移（owner 是从分录派生的冗余字段）
    invariants.push(
      await this.check(
        6,
        'item_instance.owner_account_id 等于最后一条 +1 分录的账户',
        `SELECT i."id" AS instance_id, i."owner_account_id", last."account_id" AS derived
           FROM "item_instance" i
           LEFT JOIN LATERAL (
             SELECT e."account_id" FROM "item_instance_entry" e
              WHERE e."instance_id" = i."id" AND e."delta" = 1
              ORDER BY e."id" DESC LIMIT 1
           ) last ON true
          WHERE last."account_id" IS NULL
             OR last."account_id" <> i."owner_account_id"`,
      ),
    );

    // ---- 不变量 7：ESCROW 持有量 == 托管中的实例数
    invariants.push(
      await this.check(
        7,
        'ESCROW 持有实例数 == state 为 listed/escrowed 的实例数',
        `WITH held AS (
           SELECT COUNT(*) AS c FROM "item_instance" i
             JOIN "account" a ON a."id" = i."owner_account_id"
            WHERE a."system_code" = 'ESCROW'
         ), marked AS (
           SELECT COUNT(*) AS c FROM "item_instance"
            WHERE "state" IN ('listed','escrowed')
         )
         SELECT held."c" AS escrow_held, marked."c" AS state_marked
           FROM held, marked WHERE held."c" <> marked."c"`,
      ),
    );

    // ---- 不变量 8：合规配置未被手工绕过（DB CHECK 已兜底）
    invariants.push(
      await this.check(
        8,
        '不存在 tradable 且 redeemable/gacha_output 的资产',
        `SELECT "code", "tradable", "redeemable", "gacha_output"
           FROM "asset_def"
          WHERE ("tradable" AND "redeemable") OR ("tradable" AND "gacha_output")`,
      ),
    );

    // ---- 不变量 9：批次聚合 == 余额快照
    invariants.push(
      await this.check(
        9,
        'SUM(asset_lot) == asset_balance',
        `SELECT b."account_id", b."asset_code", b."available", b."frozen",
                COALESCE(l."r", 0) AS lot_available,
                COALESCE(l."f", 0) AS lot_frozen
           FROM "asset_balance" b
           LEFT JOIN (
             SELECT "account_id", "asset_code",
                    SUM("remaining") AS r, SUM("frozen") AS f
               FROM "asset_lot" GROUP BY 1, 2
           ) l ON l."account_id" = b."account_id" AND l."asset_code" = b."asset_code"
          WHERE b."available" <> COALESCE(l."r", 0)
             OR b."frozen"    <> COALESCE(l."f", 0)`,
      ),
    );

    // ---- 不变量 10：过期作业无遗漏
    invariants.push(
      await this.check(
        10,
        '不存在已过期但仍有余量的批次',
        `SELECT "id", "account_id", "asset_code", "remaining", "expires_at"
           FROM "asset_lot" WHERE "expires_at" < now() AND "remaining" > 0`,
      ),
    );

    // ---- 不变量 11：限量未超发（DB CHECK 已兜底）
    invariants.push(
      await this.check(
        11,
        '限量资产未超发',
        `SELECT "code", "minted_count", "mint_limit" FROM "asset_def"
          WHERE "mint_limit" IS NOT NULL AND "minted_count" > "mint_limit"`,
      ),
    );

    const accountCount = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(`SELECT COUNT(*) AS c FROM "account"`),
      )[0]?.c ?? 0,
    );

    return {
      checkedAt: this.clock.now().toISOString(),
      accountCount,
      invariants,
      liabilities: await this.liabilities(),
      statRowsMaterialized: await this.materializeDailyStat(),
      ok: invariants.every((i) => i.ok),
    };
  }

  // ---------------------------------------------------------------- 内部

  /** 跑一条「查出来就是异常」的 SQL，把结果归成 `InvariantResult`。 */
  private async check(
    id: number,
    name: string,
    sql: string,
  ): Promise<InvariantResult> {
    try {
      const rows = rowsOf<Record<string, unknown>>(await this.ds.query(sql));
      return {
        id,
        name,
        ok: rows.length === 0,
        count: rows.length,
        samples: rows.slice(0, SAMPLE_LIMIT),
      };
    } catch (err) {
      // 单条校验的 SQL 出错不该让整轮对账失败——其余 10 条仍有诊断价值
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`不变量 #${id} 校验执行失败：${message}`);
      return {
        id,
        name,
        ok: false,
        count: -1,
        samples: [{ error: message }],
      };
    }
  }

  /**
   * 物化发行/销毁日报。
   *
   * 为什么必须单独物化而不能从分录求和推出：`issue`/`burn` 是单边凭证，不守恒，
   * 所以「本月发了多少币」在分录里表现为「一堆正数和一堆负数混在一起」，
   * 而财务要的是分开的两个口径。这张表就是那两个口径的落点。
   *
   * 只重算最近 3 天：更早的日子不会再有新分录落进去（分录只追加），
   * 全量重算会随着时间线性变慢。
   */
  private async materializeDailyStat(): Promise<number> {
    const res = rowsOf<{ stat_day: string }>(
      await this.ds.query(
        `INSERT INTO "asset_daily_stat" ("stat_day","asset_code","reason","issued","burned")
         SELECT (e."created_at" AT TIME ZONE 'Asia/Shanghai')::date AS stat_day,
                e."asset_code",
                t."reason",
                COALESCE(SUM(CASE WHEN e."delta" > 0 THEN e."delta" ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN e."delta" < 0 THEN -e."delta" ELSE 0 END), 0)
           FROM "asset_entry" e
           JOIN "asset_txn" t ON t."id" = e."txn_id"
          WHERE t."kind" IN ('issue','burn','reversal')
            AND e."created_at" >= now() - interval '3 days'
          GROUP BY 1, 2, 3
         ON CONFLICT ("stat_day","asset_code","reason")
         DO UPDATE SET "issued" = EXCLUDED."issued", "burned" = EXCLUDED."burned"
         RETURNING "stat_day"`,
      ),
    );
    return res.length;
  }

  /**
   * 可兑资产的待兑付负债。
   *
   * 只统计 `redeemable` 资产：能换成实物的那部分才是真负债，
   * 纯虚拟闭环的 `game_coin` 发多少都不构成对外义务。
   */
  private async liabilities(): Promise<LiabilityReport[]> {
    const rows = rowsOf<{
      asset_code: string;
      issued: string;
      burned: string;
    }>(
      await this.ds.query(
        `SELECT d."code" AS asset_code,
                COALESCE(SUM(CASE WHEN e."delta" > 0 THEN e."delta" ELSE 0 END), 0) AS issued,
                COALESCE(SUM(CASE WHEN e."delta" < 0 THEN -e."delta" ELSE 0 END), 0) AS burned
           FROM "asset_def" d
           LEFT JOIN "asset_entry" e ON e."asset_code" = d."code"
          WHERE d."redeemable" = true
          GROUP BY d."code"`,
      ),
    );
    const out = rows.map((r) => ({
      assetCode: r.asset_code,
      issued: Number(r.issued),
      burned: Number(r.burned),
      outstanding: Number(r.issued) - Number(r.burned),
    }));
    // 即使一条流水都还没有，也要把 marketing_point 报出来（值为 0），
    // 否则运维看不到这一行会以为统计漏了
    if (!out.some((o) => o.assetCode === MARKETING_POINT)) {
      out.push({
        assetCode: MARKETING_POINT,
        issued: 0,
        burned: 0,
        outstanding: 0,
      });
    }
    return out;
  }
}
