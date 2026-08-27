import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { rowsOf } from '../common/db/query-result';
import type { InstanceState } from '../entities/item-instance.entity';
import { AccountService } from './account.service';

/** 玩家持有的一件唯一物品。 */
export interface InstanceView {
  instanceId: string;
  assetCode: string;
  state: InstanceState;
  serial: number | null;
  acquiredAt: string;
  tradableAfter: string | null;
}

/**
 * 背包只读视图。
 *
 * 「持有」有两种存储形态，本服务把它们统一成调用方能用的口径：
 *  - `unique`（皮肤/配饰）→ `item_instance` 行，持有量 = 实例条数
 *  - `stackable`（家具/消耗品）→ `asset_balance.available`
 *
 * 拆成两种形态而不是共用一个 qty 列，是因为件数与身份是两种语义：
 * 皮肤要能编号、能单独挂单、能追溯流转，家具只需要一个数。
 * 调用方要件数就问件数，要「有没有」就问有没有，不必知道底下存在哪张表。
 *
 * ⚠ 挂单中的唯一物品归 `ESCROW` 账户持有，因此**不计入**本视图。这是有意的：
 * 挂着卖的皮肤不该还能穿在身上，否则「边穿边卖」会让买家收到一件正在被使用的物品。
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly accounts: AccountService,
  ) {}

  /**
   * 全部持有量（assetCode -> 件数）。唯一物品按实例条数，可堆叠按可用余额。
   */
  async ownedMap(userId: string): Promise<Map<string, number>> {
    const accountId = await this.accounts.peek({ userId });
    if (!accountId) return new Map();

    const out = new Map<string, number>();

    const stack = rowsOf<{ asset_code: string; qty: string }>(
      await this.ds.query(
        `SELECT b."asset_code", b."available" AS qty
           FROM "asset_balance" b
           JOIN "asset_def" d ON d."code" = b."asset_code"
          WHERE b."account_id" = $1 AND b."available" > 0 AND d."kind" = 'stackable'`,
        [accountId],
      ),
    );
    for (const r of stack) out.set(r.asset_code, Number(r.qty));

    // `state <> 'burned'` 必须带：销毁的实例保留 owner 不改（好让对账不变量 6
    // 对它依然成立），不过滤的话回收掉的皮肤还会显示在背包里
    const uniq = rowsOf<{ asset_code: string; qty: string }>(
      await this.ds.query(
        `SELECT "asset_code", COUNT(*) AS qty FROM "item_instance"
          WHERE "owner_account_id" = $1 AND "state" <> 'burned'
          GROUP BY "asset_code"`,
        [accountId],
      ),
    );
    for (const r of uniq) {
      out.set(r.asset_code, (out.get(r.asset_code) ?? 0) + Number(r.qty));
    }
    return out;
  }

  async ownedQty(userId: string, assetCode: string): Promise<number> {
    return (await this.ownedMap(userId)).get(assetCode) ?? 0;
  }

  /** 玩家持有的全部唯一物品实例。 */
  async listInstances(
    userId: string,
    assetCode?: string,
  ): Promise<InstanceView[]> {
    const accountId = await this.accounts.peek({ userId });
    if (!accountId) return [];

    const params: unknown[] = [accountId];
    let where = `"owner_account_id" = $1 AND "state" <> 'burned'`;
    if (assetCode) {
      params.push(assetCode);
      where += ` AND "asset_code" = $2`;
    }
    const rows = rowsOf<{
      id: string;
      asset_code: string;
      state: InstanceState;
      serial: number | null;
      acquired_at: Date;
      tradable_after: Date | null;
    }>(
      await this.ds.query(
        `SELECT "id","asset_code","state","serial","acquired_at","tradable_after"
           FROM "item_instance" WHERE ${where} ORDER BY "id" ASC`,
        params,
      ),
    );
    return rows.map((r) => ({
      instanceId: String(r.id),
      assetCode: r.asset_code,
      state: r.state,
      serial: r.serial,
      acquiredAt: new Date(r.acquired_at).toISOString(),
      tradableAfter: r.tradable_after
        ? new Date(r.tradable_after).toISOString()
        : null,
    }));
  }

  /**
   * 收藏统计：按表现层类型数「拥有多少**种**」（不是多少件）。
   *
   * 图鉴的收集条目按之推进。数种类而非件数，是因为同一件家具可以买多份摆满房间，
   * 按件数算的话「收集 10 种家具」用一种家具刷十次就达成了。
   */
  async ownedKindCount(userId: string): Promise<Record<string, number>> {
    const accountId = await this.accounts.peek({ userId });
    if (!accountId) return {};

    const out: Record<string, number> = {};
    const add = (t: string | null, n: number) => {
      if (!t) return;
      out[t] = (out[t] ?? 0) + n;
    };

    const stack = rowsOf<{ t: string | null; kinds: string }>(
      await this.ds.query(
        `SELECT d."meta" ->> 'itemType' AS t, COUNT(DISTINCT b."asset_code") AS kinds
           FROM "asset_balance" b
           JOIN "asset_def" d ON d."code" = b."asset_code"
          WHERE b."account_id" = $1 AND b."available" > 0 AND d."kind" = 'stackable'
          GROUP BY 1`,
        [accountId],
      ),
    );
    for (const r of stack) add(r.t, Number(r.kinds));

    const uniq = rowsOf<{ t: string | null; kinds: string }>(
      await this.ds.query(
        `SELECT d."meta" ->> 'itemType' AS t, COUNT(DISTINCT i."asset_code") AS kinds
           FROM "item_instance" i
           JOIN "asset_def" d ON d."code" = i."asset_code"
          WHERE i."owner_account_id" = $1 AND i."state" <> 'burned'
          GROUP BY 1`,
        [accountId],
      ),
    );
    for (const r of uniq) add(r.t, Number(r.kinds));

    return out;
  }
}
