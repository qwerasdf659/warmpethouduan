import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';

/** 钱包余额与流水累计不一致的一条记录。 */
export interface WalletMismatch {
  userId: string;
  pool: 'game' | 'marketing';
  wallet: number;
  ledgerSum: number;
  diff: number;
}

export interface ReconcileReport {
  checkedAt: string;
  walletCount: number;
  /** `wallet != sum(ledger.delta)` 的条目 */
  mismatches: WalletMismatch[];
  /** 余额为负（经济层的原子扣减不该允许，出现即为绕过写入口） */
  negatives: { userId: string; pool: 'game' | 'marketing'; amount: number }[];
  /** 有流水但没有钱包行的玩家（钱包被误删） */
  orphanLedgerUsers: string[];
  ok: boolean;
}

/**
 * 每日对账：校验 `wallet == sum(ledger.delta)`（按玩家 × 池）。
 *
 * 为什么需要：全项目 `UPDATE wallet` 与 `INSERT INTO ledger` 只出现在 EconomyService
 * 一处、且在同一事务里，所以正常代码路径不会漂移。真正的风险是**手工 SQL 改余额不补流水**
 * ——数据库层没有任何约束能拦住它，而这恰恰是排障、补偿、压测时最容易做的操作。
 * 这个作业只读不写：发现问题打 ERROR 日志给运维，不自动改账（自动纠账会把证据也一起改掉）。
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
   * 每天 04:10（业务时区）跑一次，避开零点结算与日间高峰。
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
          this.logger.log(`对账通过：${report.walletCount} 个钱包全部对平`);
          return;
        }
        this.logger.error(
          `对账发现异常：余额与流水不符 ${report.mismatches.length} 条、` +
            `负余额 ${report.negatives.length} 条、孤儿流水 ${report.orphanLedgerUsers.length} 人`,
        );
        for (const m of report.mismatches.slice(0, 20)) {
          this.logger.error(
            `  user=${m.userId} pool=${m.pool} wallet=${m.wallet} ledger=${m.ledgerSum} diff=${m.diff}`,
          );
        }
      },
      // 抢不到锁说明别处正在跑，直接放弃本轮而不是排队等
      { ttlMs: 600_000, retries: 0 },
    );
  }

  /** 立即执行一次对账（后台「立即对账」按钮与定时作业共用）。 */
  async run(): Promise<ReconcileReport> {
    const rows = await this.ds.query<
      {
        user_id: string;
        game_wallet: string;
        game_ledger: string;
        mkt_wallet: string;
        mkt_ledger: string;
      }[]
    >(`
      WITH sums AS (
        SELECT user_id, pool, SUM(delta) AS s FROM ledger GROUP BY user_id, pool
      )
      SELECT w.user_id,
             w.game_coin           AS game_wallet,
             COALESCE(g.s, 0)      AS game_ledger,
             w.marketing_point     AS mkt_wallet,
             COALESCE(m.s, 0)      AS mkt_ledger
      FROM wallet w
      LEFT JOIN sums g ON g.user_id = w.user_id AND g.pool = 'game'
      LEFT JOIN sums m ON m.user_id = w.user_id AND m.pool = 'marketing'
      WHERE w.game_coin <> COALESCE(g.s, 0)
         OR w.marketing_point <> COALESCE(m.s, 0)
         OR w.game_coin < 0
         OR w.marketing_point < 0
    `);

    const mismatches: WalletMismatch[] = [];
    const negatives: ReconcileReport['negatives'] = [];
    for (const r of rows) {
      const pools = [
        { pool: 'game' as const, w: r.game_wallet, l: r.game_ledger },
        { pool: 'marketing' as const, w: r.mkt_wallet, l: r.mkt_ledger },
      ];
      for (const { pool, w, l } of pools) {
        const wallet = Number(w);
        const ledgerSum = Number(l);
        if (wallet !== ledgerSum) {
          mismatches.push({
            userId: r.user_id,
            pool,
            wallet,
            ledgerSum,
            diff: wallet - ledgerSum,
          });
        }
        if (wallet < 0) {
          negatives.push({ userId: r.user_id, pool, amount: wallet });
        }
      }
    }

    const orphans = await this.ds.query<{ user_id: string }[]>(`
      SELECT DISTINCT l.user_id FROM ledger l
      LEFT JOIN wallet w ON w.user_id = l.user_id
      WHERE w.user_id IS NULL
    `);
    const counted = await this.ds.query<{ c: string }[]>(
      `SELECT COUNT(*) AS c FROM wallet`,
    );

    const orphanLedgerUsers = orphans.map((o) => o.user_id);
    return {
      checkedAt: this.clock.now().toISOString(),
      walletCount: Number(counted[0]?.c ?? 0),
      mismatches,
      negatives,
      orphanLedgerUsers,
      ok:
        mismatches.length === 0 &&
        negatives.length === 0 &&
        orphanLedgerUsers.length === 0,
    };
  }
}
