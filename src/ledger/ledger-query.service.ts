import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { rowsOf } from '../common/db/query-result';
import { AccountService } from './account.service';
import { BalanceView, EntryView, TxnKind } from './ledger.types';

interface EntryRow {
  id: string;
  txn_id: string;
  asset_code: string;
  delta: string;
  frozen_delta: string;
  balance_after: string;
  frozen_after: string;
  kind: TxnKind;
  reason: string;
  biz_id: string;
  ref_id: string | null;
  created_at: Date;
}

/**
 * 账本的只读层：余额快照与流水分页。
 *
 * 从 `LedgerService` 拆出来的都是**不写库**的查询。写路径（过账、冲正、批次分摊、
 * 实例铸造/转移）是一台环环相扣的事务引擎，留在 `LedgerService`；读路径只做
 * 「查表 + bigint→number + 拼视图」，抽出来后两者互不干扰。
 *
 * `LedgerService` 仍通过注入本服务复用 `balances`（幂等回放要回带当前余额），
 * 对外的 `balances/history/globalHistory` 也保留为薄委托，调用方无感知。
 */
@Injectable()
export class LedgerQueryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly accounts: AccountService,
  ) {}

  /** 玩家全部资产余额（assetCode -> 可用/冻结）。 */
  async balances(userId: string): Promise<Record<string, BalanceView>> {
    const accountId = await this.accounts.peek({ userId });
    if (!accountId) return {};
    const rows = rowsOf<{
      asset_code: string;
      available: string;
      frozen: string;
    }>(
      await this.ds.query(
        `SELECT "asset_code","available","frozen" FROM "asset_balance" WHERE "account_id" = $1`,
        [accountId],
      ),
    );
    const out: Record<string, BalanceView> = {};
    for (const r of rows) {
      out[r.asset_code] = {
        available: this.num(r.available),
        frozen: this.num(r.frozen),
      };
    }
    return out;
  }

  /** 玩家流水分页（倒序）。 */
  async history(
    userId: string,
    opts: { page: number; pageSize: number; assetCode?: string },
  ): Promise<{ list: EntryView[]; total: number }> {
    const accountId = await this.accounts.peek({ userId });
    if (!accountId) return { list: [], total: 0 };

    const params: unknown[] = [accountId];
    let where = `e."account_id" = $1`;
    if (opts.assetCode) {
      params.push(opts.assetCode);
      where += ` AND e."asset_code" = $${params.length}`;
    }

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c FROM "asset_entry" e WHERE ${where}`,
          params,
        ),
      )[0]?.c ?? 0,
    );
    params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
    const rows = rowsOf<EntryRow>(
      await this.ds.query(
        `SELECT e."id", e."txn_id", e."asset_code", e."delta", e."frozen_delta",
                e."balance_after", e."frozen_after", e."created_at",
                t."kind", t."reason", t."biz_id", t."ref_id"
           FROM "asset_entry" e JOIN "asset_txn" t ON t."id" = e."txn_id"
          WHERE ${where}
          ORDER BY e."created_at" DESC, e."id" DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
    );
    return {
      list: rows.map((r) => this.toEntryView(r)),
      total,
    };
  }

  /** 后台全局流水分页（倒序），可按玩家 / 资产 / 原因筛选。 */
  async globalHistory(opts: {
    page: number;
    pageSize: number;
    userId?: string;
    assetCode?: string;
    reason?: string;
  }): Promise<{
    list: (EntryView & { userId: string | null })[];
    total: number;
  }> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (opts.userId) {
      params.push(opts.userId);
      clauses.push(`a."user_id" = $${params.length}`);
    }
    if (opts.assetCode) {
      params.push(opts.assetCode);
      clauses.push(`e."asset_code" = $${params.length}`);
    }
    if (opts.reason) {
      params.push(opts.reason);
      clauses.push(`t."reason" = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c
             FROM "asset_entry" e
             JOIN "asset_txn" t ON t."id" = e."txn_id"
             JOIN "account" a  ON a."id" = e."account_id"
           ${where}`,
          params,
        ),
      )[0]?.c ?? 0,
    );
    params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
    const rows = rowsOf<EntryRow & { user_id: string | null }>(
      await this.ds.query(
        `SELECT e."id", e."txn_id", e."asset_code", e."delta", e."frozen_delta",
                e."balance_after", e."frozen_after", e."created_at",
                t."kind", t."reason", t."biz_id", t."ref_id", a."user_id"
           FROM "asset_entry" e
           JOIN "asset_txn" t ON t."id" = e."txn_id"
           JOIN "account" a  ON a."id" = e."account_id"
         ${where}
          ORDER BY e."created_at" DESC, e."id" DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
    );
    return {
      list: rows.map((r) => ({
        ...this.toEntryView(r),
        userId: r.user_id ? String(r.user_id) : null,
      })),
      total,
    };
  }

  private toEntryView(r: EntryRow): EntryView {
    return {
      id: String(r.id),
      txnId: String(r.txn_id),
      assetCode: r.asset_code,
      delta: this.num(r.delta),
      frozenDelta: this.num(r.frozen_delta),
      balanceAfter: this.num(r.balance_after),
      frozenAfter: this.num(r.frozen_after),
      kind: r.kind,
      reason: r.reason,
      bizId: r.biz_id,
      refId: r.ref_id,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  /**
   * bigint(string) → number。金额存 bigint 是为了不吃浮点误差、量级留足，
   * 但出参用 number（前端直接算够不够买，免 BigInt 解析）。
   * 2^53 ≈ 9.0e15，宠物游戏币量级远达不到；真越界宁可显式报错也不静默丢精度。
   */
  private num(v: string | number): number {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isSafeInteger(n)) {
      throw new InternalServerErrorException('账户金额超出安全整数范围');
    }
    return n;
  }
}
