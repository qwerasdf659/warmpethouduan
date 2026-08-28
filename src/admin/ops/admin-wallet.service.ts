import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { rowsOf } from '../../common/db/query-result';
import { BUSINESS_TZ } from '../../common/time/business-day';
import { EconomyService, WalletView } from '../../economy/economy.service';
import { User } from '../../entities/user.entity';
import { LedgerService } from '../../ledger/ledger.service';
import {
  GrantWalletBulkDto,
  GrantWalletDto,
  QueryDailyStatsDto,
  QueryLedgerDto,
  ReverseTxnDto,
} from './dto/wallet-admin.dto';

/** 发行日报的一行：某天某资产某原因的发行与销毁量。 */
export interface DailyAssetStat {
  statDay: string;
  assetCode: string;
  reason: string;
  issued: number;
  burned: number;
  /** 净发行 = 发行 − 销毁。持续为正即通胀 */
  net: number;
}

/** 按资产汇总的发行口径（通胀总览）。 */
export interface AssetIssuanceSummary {
  assetCode: string;
  issued: number;
  burned: number;
  net: number;
}

/** 一个批次（lot）的后台视图。批次是余额的分桶实现，承载 FIFO 消耗与过期。 */
export interface AssetLotView {
  id: string;
  accountId: string;
  /** 系统账户没有 user_id，这里为 null */
  userId: string | null;
  assetCode: string;
  remaining: string;
  frozen: string;
  issuedTotal: string;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * 后台钱包运营：全局流水查询 + 人工发币/扣币。
 * 所有余额变动一律委托 EconomyService.apply（DB 原子记账 + 持久幂等）。
 */
@Injectable()
export class AdminWalletService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly economy: EconomyService,
    private readonly ledger: LedgerService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * 发行/销毁日报（读 `asset_daily_stat`，由每日对账物化）。
   *
   * 一表三用：**通胀监控**（数值策划看某资产的净发行趋势）、
   * **刷币外挂告警**（某个 reason 的产出突增）、
   * **待兑付负债**（`marketing_point` 的累计发行 − 兑付）。
   *
   * 为什么不实时从分录求和：`issue`/`burn` 是单边凭证、不守恒，
   * 「本月发了多少币」在分录里表现为一堆正数和一堆负数混在一起，
   * 而财务要的是分开的两个口径 —— 那正是这张物化表存在的理由。
   */
  async dailyStats(q: QueryDailyStatsDto): Promise<{
    list: DailyAssetStat[];
    summary: AssetIssuanceSummary[];
    days: number;
  }> {
    const days = q.days ?? 30;
    const params: unknown[] = [days];
    let where = `"stat_day" >= (now() AT TIME ZONE '${BUSINESS_TZ}')::date - $1::int`;
    if (q.assetCode) {
      params.push(q.assetCode);
      where += ` AND "asset_code" = $${params.length}`;
    }
    if (q.reason) {
      params.push(q.reason);
      where += ` AND "reason" = $${params.length}`;
    }

    const rows = rowsOf<{
      stat_day: Date;
      asset_code: string;
      reason: string;
      issued: string;
      burned: string;
    }>(
      await this.ds.query(
        `SELECT "stat_day","asset_code","reason","issued","burned"
           FROM "asset_daily_stat"
          WHERE ${where}
          ORDER BY "stat_day" DESC, "asset_code", "reason"`,
        params,
      ),
    );

    const list = rows.map((r) => {
      const issued = Number(r.issued);
      const burned = Number(r.burned);
      return {
        // stat_day 是 date 列，pg 驱动给回 Date；只取日历日，避免时区把日期挪一天
        statDay: new Date(r.stat_day).toISOString().slice(0, 10),
        assetCode: r.asset_code,
        reason: r.reason,
        issued,
        burned,
        net: issued - burned,
      };
    });

    const byAsset = new Map<string, AssetIssuanceSummary>();
    for (const r of list) {
      const cur = byAsset.get(r.assetCode) ?? {
        assetCode: r.assetCode,
        issued: 0,
        burned: 0,
        net: 0,
      };
      cur.issued += r.issued;
      cur.burned += r.burned;
      cur.net += r.net;
      byAsset.set(r.assetCode, cur);
    }

    return {
      list,
      summary: [...byAsset.values()].sort((a, b) => b.net - a.net),
      days,
    };
  }

  /** 全局流水分页。 */
  listLedger(q: QueryLedgerDto) {
    return this.economy.listGlobalLedger({
      page: q.page,
      pageSize: q.pageSize,
      userId: q.userId,
      assetCode: q.assetCode,
      reason: q.reason,
    });
  }

  /**
   * 资产批次（lot）清单。
   *
   * 余额只是批次的汇总，「哪一批、什么时候过期」只有这张表知道，而这个信息
   * 事后补不回来。运营真正会用到它的两个场景：核对某玩家余额是怎么攒起来的，
   * 以及在过期批处理跑之前先看一眼「这周要过期多少」。
   */
  async assetLots(q: {
    page: number;
    pageSize: number;
    userId?: string;
    assetCode?: string;
    filter?: 'remaining' | 'expiring';
  }): Promise<{ list: AssetLotView[]; total: number }> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (q.userId) {
      params.push(q.userId);
      clauses.push(`a."user_id" = $${params.length}`);
    }
    if (q.assetCode) {
      params.push(q.assetCode);
      clauses.push(`l."asset_code" = $${params.length}`);
    }
    if (q.filter === 'remaining') clauses.push(`l."remaining" > 0`);
    if (q.filter === 'expiring') {
      clauses.push(`l."expires_at" IS NOT NULL AND l."remaining" > 0`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c FROM "asset_lot" l
             JOIN "account" a ON a."id" = l."account_id" ${where}`,
          params,
        ),
      )[0]?.c ?? 0,
    );

    // 即将过期的排前面；没有过期时间的批次（永不过期）排最后
    const order =
      q.filter === 'expiring'
        ? `ORDER BY l."expires_at" ASC`
        : `ORDER BY l."expires_at" ASC NULLS LAST, l."id" DESC`;

    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const rows = rowsOf<{
      id: string;
      account_id: string;
      user_id: string | null;
      asset_code: string;
      remaining: string;
      frozen: string;
      issued_total: string;
      expires_at: Date | null;
      created_at: Date;
    }>(
      await this.ds.query(
        `SELECT l.*, a."user_id" FROM "asset_lot" l
           JOIN "account" a ON a."id" = l."account_id"
         ${where} ${order}
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
    );

    return {
      list: rows.map((r) => ({
        id: r.id,
        accountId: r.account_id,
        userId: r.user_id,
        assetCode: r.asset_code,
        remaining: r.remaining,
        frozen: r.frozen,
        issuedTotal: r.issued_total,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      })),
      total,
    };
  }

  /** 读某玩家钱包（校验玩家存在）。 */
  async getWallet(userId: string): Promise<{ wallet: WalletView }> {
    await this.assertUserExists(userId);
    return { wallet: await this.economy.getWallet(userId) };
  }

  /** 人工发币/扣币。 */
  async grant(userId: string, dto: GrantWalletDto) {
    await this.assertUserExists(userId);
    const delta = dto.direction === 'grant' ? dto.amount : -dto.amount;
    const result = await this.economy.adminGrant({
      userId,
      assetCode: dto.assetCode,
      delta,
      bizId: dto.bizId,
      refId: null,
    });
    return result;
  }

  /**
   * 批量发币/扣币（活动补偿、批量发营销积分）。
   *
   * 三个刻意的设计：
   *  - **每人一个派生 bizId**（`{bizId}:{userId}`）：`asset_txn.biz_id` 是全局唯一的，
   *    整批共用一个 bizId 时只有第一个玩家能记上账，其余全部命中幂等回放。
   *    派生之后每人一张凭证，重试整批也完全幂等。
   *  - **单人失败不中断整批**：一个玩家不存在或扣减余额不足，不该让其余 199 人
   *    的发放回滚。逐个收集失败原因返回，运营据此补发。
   *  - **顺序执行而非 Promise.all**：批量发放不是延迟敏感操作，串行让 DB 压力可控，
   *    也让失败列表的顺序与输入一致、便于核对。
   */
  async grantBulk(dto: GrantWalletBulkDto): Promise<{
    total: number;
    succeeded: number;
    failed: { userId: string; message: string }[];
  }> {
    const delta = dto.direction === 'grant' ? dto.amount : -dto.amount;
    // 同一批里重复的 userId 去重：派生 bizId 相同，第二次本就是幂等回放，
    // 但去重能让 succeeded 计数反映真实人数而不是提交次数
    const targets = [...new Set(dto.userIds)];
    const failed: { userId: string; message: string }[] = [];
    let succeeded = 0;

    for (const userId of targets) {
      try {
        await this.assertUserExists(userId);
        await this.economy.adminGrant({
          userId,
          assetCode: dto.assetCode,
          delta,
          bizId: `${dto.bizId}:${userId}`,
          refId: null,
        });
        succeeded += 1;
      } catch (err) {
        failed.push({
          userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { total: targets.length, succeeded, failed };
  }

  /**
   * 冲正一张凭证（R7）。
   *
   * 适用场景：交易纠纷、盗号追回、配错数值的批量发放。冲正会按原凭证生成**反向
   * 分录**并写 `reversal_of`，原凭证一字不改 —— 这样「当初发生了什么」与
   * 「后来怎么修的」都留在账上。
   *
   * 两条限制由 `LedgerService.reverse` 保证：同一凭证不可重复冲正；
   * 铸造凭证不可冲正（那会让唯一物品凭空消失，破坏实例守恒）。
   */
  async reverseTxn(
    txnId: string,
    dto: ReverseTxnDto,
  ): Promise<{ txnId: string; reversedFrom: string }> {
    const result = await this.ledger.reverse(txnId, dto.bizId, 'reversal');
    return { txnId: result.txnId, reversedFrom: txnId };
  }

  private async assertUserExists(userId: string): Promise<void> {
    const u = await this.users.findOne({
      where: { id: userId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('玩家不存在');
  }
}
