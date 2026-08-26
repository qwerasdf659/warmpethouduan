import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { rowsOf } from '../common/db/query-result';
import { GameConfigService } from '../config/game-config.service';
import type {
  ListingMode,
  ListingStatus,
} from '../entities/market-listing.entity';
import { AccountService } from '../ledger/account.service';
import {
  AssetCatalogService,
  AssetView,
} from '../ledger/asset-catalog.service';
import { InventoryService } from '../ledger/inventory.service';
import { LedgerService } from '../ledger/ledger.service';
import { AccountRef, GAME_COIN, Leg, PostResult } from '../ledger/ledger.types';
import { HoldingCleanupService } from './holding-cleanup.service';
import { TradeRiskService } from './trade-risk.service';

/** 交易标的：可堆叠资产按件数，唯一物品按实例。 */
export type Subject =
  { assetCode: string; qty: number } | { instanceId: string };

/** 标的解析结果：把两种形态统一成后续流程能直接用的字段。 */
interface ResolvedSubject {
  def: AssetView;
  assetCode: string;
  /** 可堆叠标的的件数；唯一物品为 null */
  qty: number | null;
  instanceId: string | null;
  /** 参考价（商店定价 × 件数），用于限价与额度累计 */
  referenceValue: number;
}

export interface ListingView {
  id: string;
  sellerUserId: string | null;
  mode: ListingMode;
  assetCode: string;
  assetName: string;
  qty: number | null;
  instanceId: string | null;
  serial: number | null;
  priceAsset: string;
  price: number;
  feeBps: number;
  status: ListingStatus;
  expiresAt: string;
  createdAt: string;
  /** 竞价模式下的当前最高价（无人出价则为 null） */
  topBid: number | null;
}

interface ListingRow {
  id: string;
  seller_account_id: string;
  mode: ListingMode;
  asset_code: string;
  qty: string | null;
  instance_id: string | null;
  price_asset: string;
  price: string;
  fee_bps: number;
  status: ListingStatus;
  expires_at: Date;
  created_at: Date;
}

/**
 * 交易市场。四档功能共用同一套账本原语，差别只在凭证的形状：
 *
 * | 档位 | 凭证 kind | 说明 |
 * | ---- | --------- | ---- |
 * | 3a 回收 | `burn` | 无对手方：物品销毁 + 货币发行 |
 * | 3b 赠送 | `transfer` | 两条分录（或成对 ±1 实例分录），求和为 0 |
 * | 3c 寄售 | `freeze` → `transfer` | 挂单锁定，成交三方分账（买家/卖家/FEE） |
 * | 3d 竞价 | `freeze` → `transfer` | 出价冻结买家资金，被超越时解冻 |
 *
 * 两条贯穿全类的规矩：
 *
 * 1. **业务单据与账务必须同生共死**。所以每个操作都是
 *    `ds.transaction` + `ledger.postWithin`，而不是先记账再改单据 ——
 *    后者中间失败会留下「钱已经动了但挂单还显示在售」这类无法自动修复的状态。
 * 2. **锁按资源粒度取**。改挂单状态的操作锁挂单（`market:listing:{id}`），
 *    只动自己资产的操作锁玩家。绝不同时持两个玩家锁 —— Redis 锁不可重入，
 *    两个玩家互相买卖时会互等到超时。
 */
@Injectable()
export class MarketService {
  private readonly logger = new Logger('Market');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountService,
    private readonly catalog: AssetCatalogService,
    private readonly inventory: InventoryService,
    private readonly risk: TradeRiskService,
    private readonly cleanup: HoldingCleanupService,
    private readonly config: GameConfigService,
    private readonly lock: LockService,
    private readonly clock: ClockService,
  ) {}

  // ================================================================ 3a 系统回收

  /**
   * 系统回收：按商店价的一个折扣把物品卖给系统。
   *
   * 无对手方，因此是 `burn`（物品消失）+ `issue`（货币产生）合成的一张凭证。
   * 回收率**必须低于 100%**（配置上限 90%），否则「买入再回收」就是一条无风险
   * 套利通道，玩家会靠它把商店当成刷币机。
   */
  async recycle(
    userId: string,
    subject: Subject,
    bizKey: string,
  ): Promise<{ gained: number; assetCode: string }> {
    await this.risk.assertEnabled('recycle');

    return this.lock.withLock(`pet:${userId}`, async () => {
      const s = await this.resolveSubject(userId, subject, {
        requireTradable: false,
      });
      const rateBps = await this.config.get('market.recycleRateBps');
      const gained = Math.floor((s.referenceValue * rateBps) / 10_000);
      if (gained <= 0) {
        throw new BadRequestException('该物品不可回收');
      }

      /*
       * 回收款不能是可兑实物的资产。
       *
       * 回收按该物品的**计价资产**付款，而计价资产是运营在后台可改的
       * （物品编辑里的「积分池」）。若把某件道具的计价池改成营销积分，
       * 回收就变成「道具 → 可兑实物的积分」——一条把游戏内产出换成实物的通路，
       * 正是 §3 要断掉的那一环。
       *
       * 数据库的 CHECK 拦不住这个组合：`marketing_point` 本身
       * `tradable=false, redeemable=true` 完全合法，问题出在「用它给回收付款」
       * 这个动作上，只能在这里拦。
       */
      const payout = await this.catalog.getByCode(s.def.priceAsset);
      if (payout?.redeemable) {
        throw new BadRequestException(
          `不能用可兑实物的资产（${s.def.priceAsset}）支付回收款`,
        );
      }

      const bizId = `mkt:recycle:${userId}:${bizKey}`;
      try {
        await this.ds.transaction(async (m) => {
          await this.ledger.postWithin(
            m,
            {
              kind: 'burn',
              reason: 'recycle',
              bizKey: `recycle:${userId}:${bizKey}`,
              scope: 'mkt',
              actorUserId: userId,
              legs: [
                // 可堆叠标的按数量销毁；唯一物品走 instanceBurns
                ...(s.qty !== null
                  ? [
                      {
                        account: { userId } as AccountRef,
                        assetCode: s.assetCode,
                        delta: -s.qty,
                      },
                    ]
                  : []),
                {
                  account: { userId },
                  assetCode: s.def.priceAsset,
                  delta: gained,
                },
              ],
              instanceBurns: s.instanceId
                ? [{ instanceId: s.instanceId, from: { userId } }]
                : [],
              refType: 'asset_def',
              refId: s.assetCode,
            },
            bizId,
          );
        });
      } catch (e) {
        if (this.ledger.isDuplicateBizId(e)) {
          throw new ConflictException('该回收请求已处理');
        }
        throw e;
      }

      await this.cleanupAfterOutflow(userId, s.assetCode);
      return { gained, assetCode: s.def.priceAsset };
    });
  }

  // ================================================================ 3b 定向赠送

  /**
   * 定向赠送：`transfer` 凭证，两条分录（可堆叠）或成对 ±1 实例分录（唯一物品）。
   *
   * 风控在这里是**必需项而非增强项**：赠送是最纯粹的资源转移通道，没有价格、
   * 没有手续费、没有摩擦。R1（新号冷却）与 R3（日额度）之外，
   * `net_outflow` 的累计让「小号供养大号」在日报里显形（R4）。
   */
  async gift(
    fromUserId: string,
    toUserId: string,
    subject: Subject,
    bizKey: string,
  ): Promise<{ ok: true }> {
    await this.risk.assertEnabled('gift');
    if (fromUserId === toUserId) {
      throw new BadRequestException('不能赠送给自己');
    }
    await this.risk.assertAccountAge(fromUserId);
    await this.risk.assertAccountAge(toUserId);
    await this.assertUserExists(toUserId);

    return this.lock.withLock(`pet:${fromUserId}`, async () => {
      const s = await this.resolveSubject(fromUserId, subject, {
        requireTradable: true,
      });
      const fromAccount = await this.accounts.resolve({ userId: fromUserId });
      const toAccount = await this.accounts.resolve({ userId: toUserId });
      await this.risk.assertDailyQuota(fromAccount, s.referenceValue);

      const bizId = `mkt:gift:${fromUserId}:${bizKey}`;
      try {
        await this.ds.transaction(async (m) => {
          await this.ledger.postWithin(
            m,
            {
              kind: 'transfer',
              reason: 'gift',
              bizKey: `gift:${fromUserId}:${bizKey}`,
              scope: 'mkt',
              actorUserId: fromUserId,
              legs:
                s.qty !== null
                  ? [
                      {
                        account: { userId: fromUserId },
                        assetCode: s.assetCode,
                        delta: -s.qty,
                      },
                      {
                        account: { userId: toUserId },
                        assetCode: s.assetCode,
                        delta: s.qty,
                      },
                    ]
                  : [],
              instanceMoves: s.instanceId
                ? [
                    {
                      instanceId: s.instanceId,
                      from: { userId: fromUserId },
                      to: { userId: toUserId },
                      toState: 'held',
                    },
                  ]
                : [],
              refType: 'user',
              refId: toUserId,
            },
            bizId,
          );

          // 额度累计与成交同事务：分开写的话「成交了但额度没记上」等于额度形同虚设
          await this.risk.record(
            m,
            fromAccount,
            s.referenceValue,
            s.referenceValue,
          );
          await this.risk.record(m, toAccount, 0, -s.referenceValue);
        });
      } catch (e) {
        if (this.ledger.isDuplicateBizId(e)) {
          throw new ConflictException('该赠送请求已处理');
        }
        throw e;
      }

      await this.cleanupAfterOutflow(fromUserId, s.assetCode);
      return { ok: true };
    });
  }

  // ================================================================ 3c/3d 挂单

  /**
   * 挂单：把标的锁起来，写一行 `market_listing`。
   *
   * 锁定的形式按资产种类分：
   *  - 唯一物品 → **转入 `ESCROW` 账户**，`state='listed'`。转移而非打标记，
   *    是因为「谁持有」必须只有一个答案 —— 打标记的话，背包查询、赠送、
   *    回收每一处都要记得排除「挂单中」，漏一处就是同一件物品卖两次。
   *  - 可堆叠资产 → 可用余额转为**冻结余额**。总量不变，但不可动用。
   */
  async list(
    userId: string,
    subject: Subject,
    price: number,
    mode: ListingMode,
    bizKey: string,
  ): Promise<ListingView> {
    await this.risk.assertEnabled(mode === 'auction' ? 'auction' : 'listing');
    await this.risk.assertAccountAge(userId);
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new BadRequestException('挂单价必须为正整数');
    }

    return this.lock.withLock(`pet:${userId}`, async () => {
      const s = await this.resolveSubject(userId, subject, {
        requireTradable: true,
      });
      await this.risk.assertPriceBand(s.referenceValue, price);
      await this.risk.warnIfAbnormalPrice(
        s.assetCode,
        s.referenceValue,
        price,
        userId,
      );

      const feeBps = await this.config.get('market.feeBps');
      const hours = await this.config.get('market.listingHours');
      const expiresAt = new Date(
        this.clock.now().getTime() + hours * 3_600_000,
      );
      const bizId = `mkt:list:${userId}:${bizKey}`;

      let listingId: string;
      try {
        listingId = await this.ds.transaction(async (m) => {
          const posted = await this.ledger.postWithin(
            m,
            {
              kind: 'freeze',
              reason: 'market_list',
              bizKey: `list:${userId}:${bizKey}`,
              scope: 'mkt',
              actorUserId: userId,
              legs:
                s.qty !== null
                  ? [
                      {
                        account: { userId },
                        assetCode: s.assetCode,
                        delta: -s.qty,
                        frozenDelta: s.qty,
                      },
                    ]
                  : [],
              instanceMoves: s.instanceId
                ? [
                    {
                      instanceId: s.instanceId,
                      from: { userId },
                      to: { systemCode: 'ESCROW' },
                      toState: 'listed',
                    },
                  ]
                : [],
              refType: 'market_listing',
            },
            bizId,
          );

          const inserted = rowsOf<{ id: string }>(
            await m.query(
              `INSERT INTO "market_listing"
                 ("seller_account_id","mode","asset_code","qty","instance_id",
                  "price_asset","price","fee_bps","status","expires_at","created_txn_id")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'listed',$9,$10)
               RETURNING "id"`,
              [
                await this.accounts.resolve({ userId }, m),
                mode,
                s.assetCode,
                s.qty,
                s.instanceId,
                s.def.priceAsset,
                price,
                feeBps,
                expiresAt,
                posted.txnId,
              ],
            ),
          );
          return String(inserted[0].id);
        });
      } catch (e) {
        if (this.ledger.isDuplicateBizId(e)) {
          // 幂等回放：找回上次那张挂单，而不是让客户端以为挂单失败
          const existing = await this.findListingByBizId(bizId);
          if (existing) return this.toView(existing);
          throw new ConflictException('请求处理中，请勿重复提交');
        }
        throw e;
      }

      await this.cleanupAfterOutflow(userId, s.assetCode);
      const row = await this.loadListing(listingId);
      return this.toView(row);
    });
  }

  /** 撤单：把锁定的标的原样退回。 */
  async cancel(
    listingId: string,
    userId: string,
    bizKey: string,
  ): Promise<{ ok: true }> {
    return this.lock.withLock(`market:listing:${listingId}`, async () => {
      const row = await this.loadListing(listingId);
      const sellerAccount = await this.accounts.resolve({ userId });
      if (row.seller_account_id !== sellerAccount) {
        throw new BadRequestException('这不是你的挂单');
      }
      if (row.status !== 'listed') {
        throw new BadRequestException('该挂单已结束');
      }

      await this.unwind(row, 'cancelled', `cancel:${listingId}:${bizKey}`);
      return { ok: true };
    });
  }

  /**
   * 3c 一价成交。
   *
   * 三方分账在**一张 `transfer` 凭证**里：买家付款、卖家收款、`FEE` 收手续费，
   * 按资产求和为 0。手续费进 `FEE` 账户即退出流通，这是交易带来的通胀 sink（R9）。
   *
   * 不需要客户端传 `bizKey`：幂等键是 `mkt:{listingId}:settle`，由挂单 id 唯一决定。
   * 一张挂单只能成交一次，因此「谁先抢到」由这个键在数据库层裁决 ——
   * 若改用客户端 bizId，两个买家并发买同一件东西会拿到两个不同的键，
   * 唯一约束就拦不住第二笔。
   */
  async buyNow(listingId: string, buyerUserId: string): Promise<PostResult> {
    await this.risk.assertEnabled('listing');
    await this.risk.assertAccountAge(buyerUserId);

    return this.lock.withLock(`market:listing:${listingId}`, async () => {
      const row = await this.loadListing(listingId);
      if (row.status !== 'listed') {
        throw new BadRequestException('该挂单已结束');
      }
      if (row.mode !== 'fixed') {
        throw new BadRequestException('竞价挂单不能一价买入');
      }
      if (new Date(row.expires_at) <= this.clock.now()) {
        throw new BadRequestException('该挂单已过期');
      }

      const buyerAccount = await this.accounts.resolve({ userId: buyerUserId });
      if (row.seller_account_id === buyerAccount) {
        // 自买自卖是刷成交量与洗白异常价格的标准手法，也会白交一笔手续费
        throw new BadRequestException('不能买自己的挂单');
      }

      const price = Number(row.price);
      await this.risk.assertDailyQuota(buyerAccount, price);

      const bizId = `mkt:${listingId}:settle`;
      try {
        return await this.ds.transaction(async (m) =>
          this.settleTrade(m, row, buyerUserId, price, bizId, false),
        );
      } catch (e) {
        if (this.ledger.isDuplicateBizId(e)) {
          throw new ConflictException('该挂单已成交');
        }
        throw e;
      }
    });
  }

  // ================================================================ 3d 竞价

  /**
   * 出价：冻结买家资金，把上一个最高价解冻。
   *
   * **必须冻结**。若只记一行出价而不锁钱，同一笔余额可以同时出价十个挂单，
   * 结算时才发现付不出来 —— 那时物品已经判给他了，只能要么让卖家白丢东西、
   * 要么回滚一笔已公示的成交结果。
   */
  async bid(
    listingId: string,
    bidderUserId: string,
    price: number,
    bizKey: string,
  ): Promise<{ bidId: string; price: number }> {
    await this.risk.assertEnabled('auction');
    await this.risk.assertAccountAge(bidderUserId);
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new BadRequestException('出价必须为正整数');
    }

    return this.lock.withLock(`market:listing:${listingId}`, async () => {
      const row = await this.loadListing(listingId);
      if (row.status !== 'listed')
        throw new BadRequestException('该挂单已结束');
      if (row.mode !== 'auction') {
        throw new BadRequestException('该挂单不接受出价');
      }
      if (new Date(row.expires_at) <= this.clock.now()) {
        throw new BadRequestException('该挂单已过期');
      }

      const bidderAccount = await this.accounts.resolve({
        userId: bidderUserId,
      });
      if (row.seller_account_id === bidderAccount) {
        throw new BadRequestException('不能给自己的挂单出价');
      }
      if (price < Number(row.price)) {
        throw new BadRequestException(`出价不得低于起拍价 ${row.price}`);
      }

      const top = await this.topBid(listingId);
      if (top && price <= Number(top.price)) {
        throw new BadRequestException(`出价必须高于当前最高价 ${top.price}`);
      }
      if (top && top.bidder_account_id === bidderAccount) {
        // 已是最高价者：加价要先退掉自己的旧出价，否则两笔冻结叠加
        throw new BadRequestException('你已是最高出价者');
      }

      await this.risk.assertDailyQuota(bidderAccount, price);

      const bizId = `mkt:bid:${listingId}:${bidderUserId}:${bizKey}`;
      try {
        return await this.ds.transaction(async (m) => {
          const frozen = await this.ledger.postWithin(
            m,
            {
              kind: 'freeze',
              reason: 'bid_freeze',
              bizKey: `bid:${listingId}:${bidderUserId}:${bizKey}`,
              scope: 'mkt',
              actorUserId: bidderUserId,
              legs: [
                {
                  account: { userId: bidderUserId },
                  assetCode: row.price_asset,
                  delta: -price,
                  frozenDelta: price,
                },
              ],
              refType: 'market_listing',
              refId: listingId,
            },
            bizId,
          );

          // 先退旧最高价再插新出价：`uq_bid_active_bidder` 只约束同一买家，
          // 但把解冻放在后面会让「同一时刻两条 active」在库里短暂存在，
          // 而对账不变量 3（frozen == SUM(frozen_delta)）在事务内看不到差异、
          // 事务外看到的是最终态，所以顺序在这里纯粹是为了读起来符合直觉
          if (top) await this.refundBid(m, top, row, 'outbid');

          const inserted = rowsOf<{ id: string }>(
            await m.query(
              `INSERT INTO "market_bid"
                 ("listing_id","bidder_account_id","price","status","freeze_txn_id")
               VALUES ($1,$2,$3,'active',$4) RETURNING "id"`,
              [listingId, bidderAccount, price, frozen.txnId],
            ),
          );
          return { bidId: String(inserted[0].id), price };
        });
      } catch (e) {
        if (this.ledger.isDuplicateBizId(e)) {
          throw new ConflictException('该出价已提交');
        }
        throw e;
      }
    });
  }

  /**
   * 竞价结算（定时作业驱动）。有人出价则判给最高价者，无人出价则原样退回卖家。
   *
   * 中标者付的是**冻结中的钱**（`frozenDelta = −price`、`delta = 0`），
   * 卖家收到的是可用余额。因此凭证的平衡口径必须算 `delta + frozenDelta`
   * 而不是只看 `delta` —— 这一点在 `LedgerService.assertBalanced` 里有说明。
   */
  async settleAuction(listingId: string): Promise<{ sold: boolean }> {
    return this.lock.withLock(`market:listing:${listingId}`, async () => {
      const row = await this.loadListing(listingId);
      if (row.status !== 'listed') return { sold: false };
      if (row.mode !== 'auction') return { sold: false };

      const top = await this.topBid(listingId);
      if (!top) {
        // 流拍：退回标的，挂单落 expired
        await this.unwind(row, 'expired', `auction-void:${listingId}`);
        return { sold: false };
      }

      const winnerUserId = await this.accounts.userIdOf(top.bidder_account_id);
      if (!winnerUserId) {
        this.logger.error(
          `挂单 ${listingId} 的最高出价账户 ${top.bidder_account_id} 不是玩家账户，跳过结算`,
        );
        return { sold: false };
      }

      const price = Number(top.price);
      const bizId = `mkt:${listingId}:settle`;
      try {
        await this.ds.transaction(async (m) => {
          await this.settleTrade(m, row, winnerUserId, price, bizId, true);
          await m.query(
            `UPDATE "market_bid" SET "status" = 'won' WHERE "id" = $1`,
            [top.id],
          );
          // 其余 active 出价全额解冻。逐条退而不是一张凭证退完：
          // 每个买家的解冻要能在他自己的流水里独立看到
          for (const other of await this.activeBids(listingId, top.id, m)) {
            await this.refundBid(m, other, row, 'cancelled');
          }
        });
      } catch (e) {
        if (this.ledger.isDuplicateBizId(e)) return { sold: true };
        throw e;
      }
      return { sold: true };
    });
  }

  // ================================================================ 读

  /** 市场浏览（在售挂单）。 */
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

  /** 到期未成交的挂单 id（定时作业用）。 */
  async findExpiredListings(limit = 200): Promise<string[]> {
    const rows = rowsOf<{ id: string }>(
      await this.ds.query(
        `SELECT "id" FROM "market_listing"
          WHERE "status" = 'listed' AND "expires_at" <= now()
          ORDER BY "expires_at" ASC LIMIT $1`,
        [limit],
      ),
    );
    return rows.map((r) => String(r.id));
  }

  /** 超时处理：竞价走结算（可能有人出价），一价直接退回。 */
  async handleExpired(listingId: string): Promise<void> {
    const row = await this.loadListing(listingId).catch(() => null);
    if (!row || row.status !== 'listed') return;

    if (row.mode === 'auction') {
      await this.settleAuction(listingId);
      return;
    }
    await this.lock.withLock(`market:listing:${listingId}`, async () => {
      const fresh = await this.loadListing(listingId);
      if (fresh.status !== 'listed') return;
      await this.unwind(fresh, 'expired', `expire:${listingId}`);
    });
  }

  // ================================================================ 内部

  /**
   * 成交分账。`fromFrozen` 区分买家的钱是「可用余额」（一价）还是「冻结余额」（竞价）。
   */
  private async settleTrade(
    m: EntityManager,
    row: ListingRow,
    buyerUserId: string,
    price: number,
    bizId: string,
    fromFrozen: boolean,
  ): Promise<PostResult> {
    const fee = Math.floor((price * row.fee_bps) / 10_000);
    const sellerGain = price - fee;
    const sellerUserId = await this.accounts.userIdOf(row.seller_account_id);
    if (!sellerUserId) {
      throw new BadRequestException('卖家账户异常');
    }

    const legs: Leg[] = [
      // 买家付款：竞价走冻结、一价走可用
      fromFrozen
        ? {
            account: { userId: buyerUserId },
            assetCode: row.price_asset,
            frozenDelta: -price,
          }
        : {
            account: { userId: buyerUserId },
            assetCode: row.price_asset,
            delta: -price,
          },
      {
        account: { userId: sellerUserId },
        assetCode: row.price_asset,
        delta: sellerGain,
      },
    ];
    // 费率为 0 时不写 FEE 腿：一条 delta 与 frozenDelta 都为 0 的分录会被
    // `ck_entry_nonzero` 拒绝，而「没有手续费」是合法配置
    if (fee > 0) {
      legs.push({
        account: { systemCode: 'FEE' },
        assetCode: row.price_asset,
        delta: fee,
      });
    }

    // 可堆叠标的：卖家的冻结份额转给买家（两条腿求和为 0）
    if (row.qty !== null) {
      const qty = Number(row.qty);
      legs.push(
        {
          account: { userId: sellerUserId },
          assetCode: row.asset_code,
          frozenDelta: -qty,
        },
        {
          account: { userId: buyerUserId },
          assetCode: row.asset_code,
          delta: qty,
        },
      );
    }

    const posted = await this.ledger.postWithin(
      m,
      {
        kind: 'transfer',
        reason: 'market_settle',
        bizKey: `${row.id}:settle`,
        scope: 'mkt',
        actorUserId: buyerUserId,
        legs,
        instanceMoves: row.instance_id
          ? [
              {
                instanceId: row.instance_id,
                from: { systemCode: 'ESCROW' },
                to: { userId: buyerUserId },
                toState: 'held',
                // 新到手的物品重新起算冷却：防「盗号 → 转手 → 立刻再转手」
                resetCooldown: true,
              },
            ]
          : [],
        refType: 'market_listing',
        refId: row.id,
      },
      bizId,
    );

    const updated = rowsOf<{ id: string }>(
      await m.query(
        `UPDATE "market_listing"
            SET "status" = 'sold', "settled_txn_id" = $2
          WHERE "id" = $1 AND "status" = 'listed'
        RETURNING "id"`,
        [row.id, posted.txnId],
      ),
    );
    if (updated.length === 0) {
      // 状态已被别的路径改掉（撤单/过期），整笔回滚
      throw new ConflictException('该挂单状态已变更，请刷新重试');
    }

    const buyerAccount = await this.accounts.resolve(
      { userId: buyerUserId },
      m,
    );
    await this.risk.record(m, buyerAccount, price, -price);
    await this.risk.record(m, row.seller_account_id, 0, price);

    return posted;
  }

  /**
   * 退回挂单标的并落终态（撤单 / 过期 / 流拍共用）。
   *
   * 同时把所有 active 出价解冻 —— 漏掉这一步就是把买家的钱永久冻在账上，
   * 而冻结余额不参与任何自动释放。
   */
  private async unwind(
    row: ListingRow,
    status: 'cancelled' | 'expired',
    bizKey: string,
  ): Promise<void> {
    const sellerUserId = await this.accounts.userIdOf(row.seller_account_id);
    if (!sellerUserId) throw new BadRequestException('卖家账户异常');
    const bizId = `mkt:unwind:${row.id}:${status}`;

    try {
      await this.ds.transaction(async (m) => {
        await this.ledger.postWithin(
          m,
          {
            kind: 'freeze',
            reason: 'market_unlist',
            bizKey,
            scope: 'mkt',
            legs:
              row.qty !== null
                ? [
                    {
                      account: { userId: sellerUserId },
                      assetCode: row.asset_code,
                      delta: Number(row.qty),
                      frozenDelta: -Number(row.qty),
                    },
                  ]
                : [],
            instanceMoves: row.instance_id
              ? [
                  {
                    instanceId: row.instance_id,
                    from: { systemCode: 'ESCROW' },
                    to: { userId: sellerUserId },
                    toState: 'held',
                    // 撤单不重置冷却：拿回自己的东西不该重新罚 72 小时
                    resetCooldown: false,
                  },
                ]
              : [],
            refType: 'market_listing',
            refId: row.id,
          },
          bizId,
        );

        for (const bid of await this.activeBids(row.id, null, m)) {
          await this.refundBid(m, bid, row, 'cancelled');
        }

        const updated = rowsOf<{ id: string }>(
          await m.query(
            `UPDATE "market_listing" SET "status" = $2
              WHERE "id" = $1 AND "status" = 'listed' RETURNING "id"`,
            [row.id, status],
          ),
        );
        if (updated.length === 0) {
          throw new ConflictException('该挂单状态已变更');
        }
      });
    } catch (e) {
      if (this.ledger.isDuplicateBizId(e)) return;
      throw e;
    }
  }

  /** 解冻一笔出价并落终态。 */
  private async refundBid(
    m: EntityManager,
    bid: { id: string; bidder_account_id: string; price: string },
    listing: { id: string; price_asset: string },
    status: 'outbid' | 'cancelled',
  ): Promise<void> {
    const userId = await this.accounts.userIdOf(bid.bidder_account_id);
    if (!userId) return;
    const price = Number(bid.price);

    await this.ledger.postWithin(m, {
      kind: 'freeze',
      reason: 'bid_refund',
      bizKey: `bid-refund:${listing.id}:${bid.id}`,
      scope: 'mkt',
      legs: [
        {
          account: { userId },
          assetCode: listing.price_asset,
          delta: price,
          frozenDelta: -price,
        },
      ],
      refType: 'market_bid',
      refId: bid.id,
    });
    await m.query(`UPDATE "market_bid" SET "status" = $2 WHERE "id" = $1`, [
      bid.id,
      status,
    ]);
  }

  private async topBid(listingId: string): Promise<{
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

  private async activeBids(
    listingId: string,
    excludeId: string | null,
    m: EntityManager,
  ): Promise<{ id: string; bidder_account_id: string; price: string }[]> {
    return rowsOf(
      await m.query(
        `SELECT "id","bidder_account_id","price" FROM "market_bid"
          WHERE "listing_id" = $1 AND "status" = 'active'
            AND ($2::bigint IS NULL OR "id" <> $2::bigint)`,
        [listingId, excludeId],
      ),
    );
  }

  /**
   * 解析交易标的：校验归属、状态、冷却与可交易性。
   *
   * `requireTradable` 对回收是 false：不可交易的扭蛋限定款仍然可以卖给系统 ——
   * 回收没有对手方，不构成玩家间流转，因此不触及「开箱变现」那条红线。
   */
  private async resolveSubject(
    userId: string,
    subject: Subject,
    opts: { requireTradable: boolean },
  ): Promise<ResolvedSubject> {
    if ('instanceId' in subject) {
      const instances = await this.inventory.listInstances(userId);
      const inst = instances.find((i) => i.instanceId === subject.instanceId);
      if (!inst) throw new NotFoundException('物品不存在或不属于你');
      if (inst.state !== 'held') {
        throw new BadRequestException('该物品正在挂单中');
      }
      // R2：获得后冷却。防盗号者即刻套现 —— 盗号的价值全在「立刻出手」
      if (
        inst.tradableAfter &&
        new Date(inst.tradableAfter) > this.clock.now()
      ) {
        throw new BadRequestException(
          `该物品需在 ${new Date(inst.tradableAfter).toLocaleString('zh-CN')} 后才可交易`,
        );
      }
      const def = await this.requireDef(inst.assetCode, opts.requireTradable);
      return {
        def,
        assetCode: def.code,
        qty: null,
        instanceId: inst.instanceId,
        referenceValue: def.price,
      };
    }

    const qty = Math.trunc(subject.qty);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw new BadRequestException('件数必须为正整数');
    }
    const def = await this.requireDef(subject.assetCode, opts.requireTradable);
    if (def.kind === 'unique') {
      throw new BadRequestException('唯一物品需按实例交易，请指定 instanceId');
    }
    const owned = await this.inventory.ownedQty(userId, def.code);
    if (owned < qty) throw new BadRequestException('持有数量不足');

    return {
      def,
      assetCode: def.code,
      qty,
      instanceId: null,
      referenceValue: def.price * qty,
    };
  }

  private async requireDef(
    assetCode: string,
    requireTradable: boolean,
  ): Promise<AssetView> {
    const def = await this.catalog.getByCode(assetCode);
    if (!def) throw new NotFoundException('资产不存在');
    if (def.kind === 'currency') {
      // 货币不作为交易标的：它是**计价物**。允许「用币买币」就等于开了汇兑市场，
      // 而双池物理隔离的全部意义就是不存在汇率
      throw new BadRequestException('货币不能作为交易标的');
    }
    if (requireTradable && !def.tradable) {
      throw new BadRequestException(`${def.name} 不可交易`);
    }
    return def;
  }

  /** 物品离手后收敛穿戴与摆放。 */
  private async cleanupAfterOutflow(
    userId: string,
    assetCode: string,
  ): Promise<void> {
    const remaining = await this.inventory.ownedQty(userId, assetCode);
    await this.cleanup.settle(userId, assetCode, remaining);
  }

  private async assertUserExists(userId: string): Promise<void> {
    const rows = rowsOf<{ id: string }>(
      await this.ds.query(`SELECT "id" FROM "user" WHERE "id" = $1`, [userId]),
    );
    if (!rows[0]) throw new NotFoundException('目标玩家不存在');
  }

  private async loadListing(listingId: string): Promise<ListingRow> {
    const rows = rowsOf<ListingRow>(
      await this.ds.query(`SELECT * FROM "market_listing" WHERE "id" = $1`, [
        listingId,
      ]),
    );
    if (!rows[0]) throw new NotFoundException('挂单不存在');
    return rows[0];
  }

  private async findListingByBizId(bizId: string): Promise<ListingRow | null> {
    const rows = rowsOf<ListingRow>(
      await this.ds.query(
        `SELECT l.* FROM "market_listing" l
           JOIN "asset_txn" t ON t."id" = l."created_txn_id"
          WHERE t."biz_id" = $1`,
        [bizId],
      ),
    );
    return rows[0] ?? null;
  }

  private async toView(row: ListingRow): Promise<ListingView> {
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
