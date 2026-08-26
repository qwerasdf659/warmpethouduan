import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { rowsOf } from '../common/db/query-result';

/** 始终保持未来这么多个月的分区可用。 */
const MONTHS_AHEAD = 12;

/**
 * `asset_entry` 的分区维护。
 *
 * 不装 `pg_partman`：多一个扩展依赖，而 Sealos 托管 PG 未必允许安装扩展，
 * 且我们要做的事只有「按月建表」这一件。
 *
 * 迁移里已预建 18 个月，本作业负责持续补建。它同时在**应用启动时**跑一次——
 * 只靠月度 Cron 的话，若某次部署恰好跨过分区耗尽的时点，记账会直接写入
 * `asset_entry_default` 兜底分区（不报错，但那个分区会越长越大且无法被
 * ATTACH 出去）。启动时补一次让「重启」成为一个自愈动作。
 */
@Injectable()
export class PartitionService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Partition');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly lock: LockService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if ((process.env.NODE_APP_INSTANCE ?? '0') !== '0') return;
    try {
      await this.ensure();
    } catch (err) {
      // 分区不足不会立刻造成故障（有 DEFAULT 兜底），不该阻断启动
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`分区补建失败（已忽略）: ${msg}`);
    }
  }

  /** 每月 1 日 03:30 补建，早于当日的过期与对账作业。 */
  @Cron('30 3 1 * *', { name: 'monthly-partition', timeZone: 'Asia/Shanghai' })
  async monthly(): Promise<void> {
    if ((process.env.NODE_APP_INSTANCE ?? '0') !== '0') return;
    await this.lock.withLock('partition:monthly', () => this.ensure(), {
      ttlMs: 300_000,
      retries: 0,
    });
  }

  /**
   * 补建缺失的月度分区，并把兜底分区里的存量行报出来。
   *
   * 用 `CREATE TABLE IF NOT EXISTS ... PARTITION OF` 而非先查再建：并发下
   * 「查到不存在 → 建」会撞 42P07，而 IF NOT EXISTS 是幂等的。
   */
  async ensure(): Promise<{ created: string[]; defaultRows: number }> {
    const created: string[] = [];

    for (let i = 0; i <= MONTHS_AHEAD; i += 1) {
      const name = rowsOf<{ name: string; existed: boolean }>(
        await this.ds.query(
          `SELECT $1::int AS ofs,
                  'asset_entry_' || to_char(date_trunc('month', now()) + ($1 || ' month')::interval, 'YYYY_MM') AS name,
                  EXISTS (
                    SELECT 1 FROM pg_class
                     WHERE relname = 'asset_entry_' || to_char(date_trunc('month', now()) + ($1 || ' month')::interval, 'YYYY_MM')
                  ) AS existed`,
          [i],
        ),
      )[0];
      if (!name || name.existed) continue;

      await this.ds.query(
        `DO $$
         DECLARE
           m date := (date_trunc('month', now()) + ($1 || ' month')::interval)::date;
         BEGIN
           EXECUTE format(
             'CREATE TABLE IF NOT EXISTS %I PARTITION OF "asset_entry" FOR VALUES FROM (%L) TO (%L)',
             'asset_entry_' || to_char(m, 'YYYY_MM'),
             m,
             (m + interval '1 month')::date
           );
         END $$`,
        [i],
      );
      created.push(name.name);
    }

    const defaultRows = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(`SELECT COUNT(*) AS c FROM "asset_entry_default"`),
      )[0]?.c ?? 0,
    );

    if (created.length > 0) {
      this.logger.log(`补建分区：${created.join(', ')}`);
    }
    if (defaultRows > 0) {
      // 兜底分区有行意味着某段时间的分区曾经缺失。它不影响读写正确性，但那些行
      // 无法随月份分区被 DETACH 归档，需要人工搬迁。
      this.logger.error(
        `asset_entry_default 存在 ${defaultRows} 行：说明曾有月份分区缺失，需人工搬迁后清空`,
      );
    }
    return { created, defaultRows };
  }
}
