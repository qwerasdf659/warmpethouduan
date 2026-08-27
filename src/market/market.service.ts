import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { rowsOf } from '../common/db/query-result';
import { GameConfigService } from '../config/game-config.service';
import type {
  ListingMode,
  ListingStatus,
} from '../entities/market-listing.entity';
import { AccountService } from '../ledger/account.service';
import { AssetCatalogService } from '../ledger/asset-catalog.service';
import { InventoryService } from '../ledger/inventory.service';
import { LedgerService } from '../ledger/ledger.service';
import { AccountRef, PostResult } from '../ledger/ledger.types';
import { SubjectResolverService } from '../trading/subject-resolver.service';
import type { Subject } from '../trading/trading.types';
import { HoldingCleanupService } from '../trading/holding-cleanup.service';
import { MarketQueryService } from './market-query.service';
import { TradeRiskService } from '../trading/trade-risk.service';
import { TradeSettlementService } from './trade-settlement.service';
import type { ListingRow, ListingView } from './market.types';

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
    private readonly subjects: SubjectResolverService,
    private readonly risk: TradeRiskService,
    private readonly cleanup: HoldingCleanupService,
    private readonly config: GameConfigService,
    private readonly lock: LockService,
    private readonly clock: ClockService,
    private readonly query: MarketQueryService,
    private readonly settlement: TradeSettlementService,
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
      const s = await this.subjects.resolve(userId, subject, {
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
      const s = await this.subjects.resolve(fromUserId, subject, {
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
      const s = await this.subjects.resolve(userId, subject, {
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
          if (existing) return this.query.toView(existing);
          throw new ConflictException('请求处理中，请勿重复提交');
        }
        throw e;
      }

      await this.cleanupAfterOutflow(userId, s.assetCode);
      const row = await this.loadListing(listingId);
      return this.query.toView(row);
    });
  }

  /**
   * 撤单：把锁定的标的原样退回。
   *
   * **刻意没有 `assertEnabled`**，这不是漏写：总闸的语义是「不许再进场」而非
   * 「冻住所有人」。关市场的典型场景是出事止血，此时标的还在 ESCROW，若撤单也一起
   * 拒绝，玩家资产就被永久锁死 —— 比市场多开几分钟严重得多。同理适用于强制撤单、
   * 到期退回与竞价结算，它们共用 `settlement.unwind`。详见 `market.config.ts` 头注释。
   */
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

      await this.settlement.unwind(
        row,
        'cancelled',
        `cancel:${listingId}:${bizKey}`,
      );
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
          this.settlement.settleTrade(m, row, buyerUserId, price, bizId, false),
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

      const top = await this.query.topBid(listingId);
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
          if (top) await this.settlement.refundBid(m, top, row, 'outbid');

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

      const top = await this.query.topBid(listingId);
      if (!top) {
        // 流拍：退回标的，挂单落 expired
        await this.settlement.unwind(
          row,
          'expired',
          `auction-void:${listingId}`,
        );
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
          await this.settlement.settleTrade(
            m,
            row,
            winnerUserId,
            price,
            bizId,
            true,
          );
          await m.query(
            `UPDATE "market_bid" SET "status" = 'won' WHERE "id" = $1`,
            [top.id],
          );
          // 其余 active 出价全额解冻。逐条退而不是一张凭证退完：
          // 每个买家的解冻要能在他自己的流水里独立看到
          for (const other of await this.settlement.activeBids(
            listingId,
            top.id,
            m,
          )) {
            await this.settlement.refundBid(m, other, row, 'cancelled');
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

  /** 市场浏览（在售挂单）。委托只读层，见 `MarketQueryService`。 */
  browse(opts: {
    assetCode?: string;
    mode?: ListingMode;
    page: number;
    pageSize: number;
  }): Promise<{ list: ListingView[]; total: number }> {
    return this.query.browse(opts);
  }

  /** 我的挂单（含已结束的，供玩家查历史）。委托只读层。 */
  myListings(
    userId: string,
    opts: { page: number; pageSize: number },
  ): Promise<{ list: ListingView[]; total: number }> {
    return this.query.myListings(userId, opts);
  }

  /** 后台挂单查询（含已结束的）。委托只读层。 */
  adminListings(opts: {
    page: number;
    pageSize: number;
    status?: ListingStatus;
    mode?: ListingMode;
    assetCode?: string;
    sellerUserId?: string;
  }): Promise<{ list: ListingView[]; total: number }> {
    return this.query.adminListings(opts);
  }

  /**
   * 后台强制撤单（违规挂单下架 / 纠纷处理）。
   *
   * 与玩家撤单唯一的区别是**不校验归属**；退回标的、解冻全部活跃出价、落终态
   * 都走同一个 `settlement.unwind`，因为「把一张单安全地拆掉」这件事只该有一种做法
   * —— 复制一份实现出来，早晚会漏掉解冻出价那一步，把买家的钱永久冻死。
   */
  async forceCancel(
    listingId: string,
    reason: string,
  ): Promise<{ ok: true; listingId: string }> {
    return this.lock.withLock(`market:listing:${listingId}`, async () => {
      const row = await this.loadListing(listingId);
      if (row.status !== 'listed') {
        throw new BadRequestException(
          `该挂单已结束（当前状态：${row.status}），无需强制撤单`,
        );
      }
      this.logger.warn(
        `后台强制撤单 listing=${listingId} asset=${row.asset_code} 理由：${reason}`,
      );
      await this.settlement.unwind(
        row,
        'cancelled',
        `admin-cancel:${listingId}`,
      );
      return { ok: true as const, listingId };
    });
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
      await this.settlement.unwind(fresh, 'expired', `expire:${listingId}`);
    });
  }

  // ================================================================ 内部

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
}
