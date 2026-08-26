import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { rowsOf } from '../common/db/query-result';
import type { SystemCode } from '../entities/account.entity';
import { LedgerService } from './ledger.service';
import { AccountRef } from './ledger.types';

export interface ExpireReport {
  ranAt: string;
  /** 处理的 (账户 × 资产) 组数 */
  groups: number;
  /** 按资产汇总的销毁量 */
  burned: Record<string, number>;
  failed: { accountId: string; assetCode: string; message: string }[];
}

interface ExpiringGroup {
  account_id: string;
  user_id: string | null;
  system_code: SystemCode | null;
  asset_code: string;
  amount: string;
}

/** 单批处理的账户资产组数。分批提交避免长事务阻塞记账主链路。 */
const BATCH_SIZE = 500;

/**
 * 批次过期批处理。
 *
 * 过期属于「凭空消失」，是 `burn` 单边凭证、**不要求平衡** —— 这正是架构设计里
 * 「守恒在积分场景不成立」的具体例证：营销积分可兑实物，运营想发就发、玩家没用就过期，
 * 硬要给它凑一个对手方账户只会让对账多一个说谎的地方。
 *
 * 幂等由 `bizId = sys:expire:{day}:{accountId}:{assetCode}` 天然保证，重跑安全。
 * 因此本作业**不需要**记录「跑到哪了」的游标：重跑一遍最多是全部命中幂等回放。
 */
@Injectable()
export class ExpireService {
  private readonly logger = new Logger('Expire');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ledger: LedgerService,
    private readonly lock: LockService,
    private readonly clock: ClockService,
  ) {}

  /**
   * 每天 04:00（业务时区）跑一次，早于 04:10 的对账 —— 顺序不能反：
   * 对账的不变量 10 会校验「不存在已过期但仍有余量的批次」，
   * 若对账先跑，它每天都会把当天该过期的批次报成异常。
   */
  @Cron('0 4 * * *', { name: 'daily-expire', timeZone: 'Asia/Shanghai' })
  async daily(): Promise<void> {
    if ((process.env.NODE_APP_INSTANCE ?? '0') !== '0') return;

    await this.lock.withLock(
      'expire:daily',
      async () => {
        const report = await this.run();
        const total = Object.values(report.burned).reduce((a, b) => a + b, 0);
        if (report.groups === 0) {
          this.logger.log('过期作业：无到期批次');
          return;
        }
        this.logger.log(
          `过期作业完成：${report.groups} 组、销毁合计 ${total}` +
            `（${Object.entries(report.burned)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')}）`,
        );
        for (const f of report.failed.slice(0, 20)) {
          this.logger.error(
            `  过期失败 account=${f.accountId} asset=${f.assetCode}: ${f.message}`,
          );
        }
      },
      // 抢不到锁说明别处正在跑，直接放弃本轮而不是排队等
      { ttlMs: 900_000, retries: 0 },
    );
  }

  /** 立即执行一次（后台按钮与定时作业共用）。 */
  async run(): Promise<ExpireReport> {
    const day = this.dayKey();
    const burned: Record<string, number> = {};
    const failed: ExpireReport['failed'] = [];
    let groups = 0;

    for (;;) {
      const batch = await this.loadBatch();
      if (batch.length === 0) break;

      for (const g of batch) {
        const amount = Number(g.amount);
        if (amount <= 0) continue;
        const ref = this.refOf(g);
        if (!ref) {
          failed.push({
            accountId: g.account_id,
            assetCode: g.asset_code,
            message: '账户既无 user_id 也无 system_code',
          });
          continue;
        }

        try {
          // 走 LedgerService 而不是直接 UPDATE：FIFO 消耗天然「先扣最早到期的」，
          // 也就是恰好扣掉这些已过期的批次，同时余额、分录、批次三层一起更新。
          // 自己写一遍 UPDATE 就等于开了第二条写入口，对账迟早对不平。
          await this.ledger.post({
            kind: 'burn',
            reason: 'expire',
            scope: 'sys',
            bizKey: `expire:${day}:${g.account_id}:${g.asset_code}`,
            legs: [{ account: ref, assetCode: g.asset_code, delta: -amount }],
            refType: 'asset_lot',
            refId: g.account_id,
          });
          groups += 1;
          burned[g.asset_code] = (burned[g.asset_code] ?? 0) + amount;
        } catch (err) {
          failed.push({
            accountId: g.account_id,
            assetCode: g.asset_code,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 全批都失败说明是系统性问题（如资产定义被删），继续循环只会刷错误日志
      if (failed.length >= batch.length && groups === 0) break;
    }

    return {
      ranAt: this.clock.now().toISOString(),
      groups,
      burned,
      failed,
    };
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 取一批待过期的 (账户 × 资产)。
   *
   * 按组聚合而不是按批次行：同一账户同一资产可能有多个已过期批次
   * （跨月的两桶同时到期），它们应该合成一张凭证，否则玩家的流水页会出现
   * 两条含义相同的「积分过期」。
   */
  private async loadBatch(): Promise<ExpiringGroup[]> {
    return rowsOf<ExpiringGroup>(
      await this.ds.query(
        `SELECT l."account_id", a."user_id", a."system_code",
                l."asset_code", SUM(l."remaining") AS amount
           FROM "asset_lot" l
           JOIN "account" a ON a."id" = l."account_id"
          WHERE l."expires_at" < now() AND l."remaining" > 0
          GROUP BY l."account_id", a."user_id", a."system_code", l."asset_code"
          ORDER BY l."account_id"
          LIMIT $1`,
        [BATCH_SIZE],
      ),
    );
  }

  private refOf(g: ExpiringGroup): AccountRef | null {
    if (g.user_id) return { userId: String(g.user_id) };
    if (g.system_code) return { systemCode: g.system_code };
    return null;
  }

  /** 业务日（用于幂等键）。同一天重跑命中同一个 bizId，回放而不重复销毁。 */
  private dayKey(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }
}
