import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { rowsOf } from '../common/db/query-result';
import type {
  ListingMode,
  ListingStatus,
} from '../entities/market-listing.entity';
import { AccountService } from '../ledger/account.service';
import { AssetCatalogService } from '../ledger/asset-catalog.service';
import { GAME_COIN } from '../ledger/ledger.types';
import type { ListingRow, ListingView } from './market.types';

/** 后台出价视图：出价本身 + 出价人玩家 id + 所属挂单的标的与状态。 */
export interface AdminBidView {
  id: string;
  listingId: string;
  listingStatus: string | null;
  assetCode: string | null;
  bidderAccountId: string;
  bidderUserId: string | null;
  price: string;
  status: string;
  /** 冻结凭证 id：追「这笔钱现在还锁着吗」时按它去查 asset_txn */
  freezeTxnId: string;
  createdAt: Date;
}

/**
 * 市场的只读/展示层。
 *
 * 从 `MarketService` 拆出来的都是**无副作用**的读：浏览、我的挂单、当前最高价、
 * 行 → 视图的翻译。写路径（挂单/成交/出价/结算）仍留在 `MarketService`，
 * 并通过注入本服务复用 `topBid`（出价与结算要读当前最高价）与 `toView`（下单回执）。
 *
 * 这样切分的意义：写路径关心的是「事务 + 锁 + 守恒」，读路径关心的是「翻页 + 拼视图」，
 * 两类关注点混在一个千行文件里时，改一处的心智负担是另一处的噪声。
 */
@Injectable()
export class MarketQueryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly catalog: AssetCatalogService,
    private readonly accounts: AccountService,
  ) {}

  /**
   * 后台挂单查询：可看**全部状态**（含已成交/已撤销/已过期），可按卖家筛。
   *
   * 与 `browse` 分开而不是给它加参数：`browse` 的语义是「市场上现在能买什么」，
   * 它必须只返回在售且未过期的单，否则玩家会看到点不动的条目。
   * 后台要的恰恰相反 —— 处理纠纷时最需要看的就是已经结束的那几单。
   */
  async adminListings(opts: {
    page: number;
    pageSize: number;
    status?: ListingStatus;
    mode?: ListingMode;
    assetCode?: string;
    sellerUserId?: string;
  }): Promise<{ list: ListingView[]; total: number }> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (opts.status) {
      params.push(opts.status);
      clauses.push(`l."status" = $${params.length}`);
    }
    if (opts.mode) {
      params.push(opts.mode);
      clauses.push(`l."mode" = $${params.length}`);
    }
    if (opts.assetCode) {
      params.push(opts.assetCode);
      clauses.push(`l."asset_code" = $${params.length}`);
    }
    if (opts.sellerUserId) {
      params.push(opts.sellerUserId);
      clauses.push(`a."user_id" = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c FROM "market_listing" l
             JOIN "account" a ON a."id" = l."seller_account_id" ${where}`,
          params,
        ),
      )[0]?.c ?? 0,
    );
    params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
    const rows = rowsOf<ListingRow>(
      await this.ds.query(
        `SELECT l.* FROM "market_listing" l
           JOIN "account" a ON a."id" = l."seller_account_id"
         ${where}
          ORDER BY l."id" DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
    );
    return { list: await Promise.all(rows.map((r) => this.toView(r))), total };
  }

  /**
   * 后台竞价出价查询。
   *
   * 出价即冻结买家资金，所以「谁出了多少、还冻着没有」是资金问题而不只是行情。
   * 强制撤单会解冻全部活跃出价 —— 在此之前后台看不到出价，运营等于闭眼点撤单，
   * 事后也无法回答「我的钱怎么少了/什么时候退的」。
   *
   * 出价方存的是 `bidder_account_id`，玩家 id 要经 `account` 换算，因此这里必须
   * join；顺带把 user_id 一起投影出去，免得前端拿到一串账户 id 无法与玩家对上。
   */
  async adminBids(opts: {
    page: number;
    pageSize: number;
    listingId?: string;
    userId?: string;
    status?: string;
  }): Promise<{ list: AdminBidView[]; total: number }> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (opts.listingId) {
      params.push(opts.listingId);
      clauses.push(`b."listing_id" = $${params.length}`);
    }
    if (opts.userId) {
      params.push(opts.userId);
      clauses.push(`a."user_id" = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      clauses.push(`b."status" = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c FROM "market_bid" b
             JOIN "account" a ON a."id" = b."bidder_account_id" ${where}`,
          params,
        ),
      )[0]?.c ?? 0,
    );

    params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
    const rows = rowsOf<{
      id: string;
      listing_id: string;
      bidder_account_id: string;
      user_id: string | null;
      price: string;
      status: string;
      freeze_txn_id: string;
      created_at: Date;
      asset_code: string | null;
      listing_status: string | null;
    }>(
      await this.ds.query(
        `SELECT b.*, a."user_id",
                l."asset_code", l."status" AS listing_status
           FROM "market_bid" b
           JOIN "account" a ON a."id" = b."bidder_account_id"
           LEFT JOIN "market_listing" l ON l."id" = b."listing_id"
         ${where}
          ORDER BY b."id" DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
    );

    return {
      list: rows.map((r) => ({
        id: r.id,
        listingId: r.listing_id,
        listingStatus: r.listing_status,
        assetCode: r.asset_code,
        bidderAccountId: r.bidder_account_id,
        bidderUserId: r.user_id,
        price: r.price,
        status: r.status,
        freezeTxnId: r.freeze_txn_id,
        createdAt: r.created_at,
      })),
      total,
    };
  }

  /** 市场浏览（在售且未过期的挂单，按价格升序）。 */
  async browse(opts: {
    assetCode?: string;
    mode?: ListingMode;
    page: number;
    pageSize: number;
  }): Promise<{ list: ListingView[]; total: number }> {
    const params: unknown[] = [];
    const clauses = [`"status" = 'listed'`, `"expires_at" > now()`];
    if (opts.assetCode) {
      params.push(opts.assetCode);
      clauses.push(`"asset_code" = $${params.length}`);
    }
    if (opts.mode) {
      params.push(opts.mode);
      clauses.push(`"mode" = $${params.length}`);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c FROM "market_listing" ${where}`,
          params,
        ),
      )[0]?.c ?? 0,
    );
    params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
    const rows = rowsOf<ListingRow>(
      await this.ds.query(
        `SELECT * FROM "market_listing" ${where}
          ORDER BY "price" ASC, "id" ASC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
    );
    return {
      list: await Promise.all(rows.map((r) => this.toView(r))),
      total,
    };
  }

  /** 我的挂单（含已结束的，供玩家查历史）。 */
  async myListings(
    userId: string,
    opts: { page: number; pageSize: number },
  ): Promise<{ list: ListingView[]; total: number }> {
    const accountId = await this.accounts.peek({ userId });
    if (!accountId) return { list: [], total: 0 };

    const total = Number(
      rowsOf<{ c: string }>(
        await this.ds.query(
          `SELECT COUNT(*) AS c FROM "market_listing" WHERE "seller_account_id" = $1`,
          [accountId],
        ),
      )[0]?.c ?? 0,
    );
    const rows = rowsOf<ListingRow>(
      await this.ds.query(
        `SELECT * FROM "market_listing" WHERE "seller_account_id" = $1
          ORDER BY "id" DESC LIMIT $2 OFFSET $3`,
        [accountId, opts.pageSize, (opts.page - 1) * opts.pageSize],
      ),
    );
    return {
      list: await Promise.all(rows.map((r) => this.toView(r))),
      total,
    };
  }

  /** 某挂单当前最高的活跃出价（无人出价返回 null）。 */
  async topBid(listingId: string): Promise<{
    id: string;
    bidder_account_id: string;
    price: string;
  } | null> {
    const rows = rowsOf<{
      id: string;
      bidder_account_id: string;
      price: string;
    }>(
      await this.ds.query(
        `SELECT "id","bidder_account_id","price" FROM "market_bid"
          WHERE "listing_id" = $1 AND "status" = 'active'
          ORDER BY "price" DESC, "created_at" ASC LIMIT 1`,
        [listingId],
      ),
    );
    return rows[0] ?? null;
  }

  /** 行 → 对外视图：补齐资产名、限量编号与竞价当前最高价。 */
  async toView(row: ListingRow): Promise<ListingView> {
    const def = await this.catalog.getByCode(row.asset_code);
    const top = row.mode === 'auction' ? await this.topBid(row.id) : null;
    let serial: number | null = null;
    if (row.instance_id) {
      serial =
        rowsOf<{ serial: number | null }>(
          await this.ds.query(
            `SELECT "serial" FROM "item_instance" WHERE "id" = $1`,
            [row.instance_id],
          ),
        )[0]?.serial ?? null;
    }
    return {
      id: String(row.id),
      sellerUserId: await this.accounts.userIdOf(row.seller_account_id),
      mode: row.mode,
      assetCode: row.asset_code,
      assetName: def?.name ?? row.asset_code,
      qty: row.qty === null ? null : Number(row.qty),
      instanceId: row.instance_id ? String(row.instance_id) : null,
      serial,
      priceAsset: row.price_asset ?? GAME_COIN,
      price: Number(row.price),
      feeBps: row.fee_bps,
      status: row.status,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      topBid: top ? Number(top.price) : null,
    };
  }
}
