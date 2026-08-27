import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { rowsOf } from '../common/db/query-result';
import { AccountService } from '../ledger/account.service';
import { LedgerService } from '../ledger/ledger.service';
import { Leg, PostResult } from '../ledger/ledger.types';
import { TradeRiskService } from '../trading/trade-risk.service';
import type { ListingRow } from './market.types';

/**
 * 交易的结算机制层：成交分账、退回标的、解冻出价。
 *
 * 从 `MarketService` 拆出来的都是**在调用方事务内改资产**的原语。`MarketService`
 * 负责准入（风控、锁、状态校验）与编排，本服务负责把「钱与物怎么在账本上移动」
 * 这件事做对——两者的关注点不同：前者关心「能不能做」，后者关心「做的时候守恒」。
 *
 * 除 `unwind` 自带一个事务外，其余方法都接收调用方的 `EntityManager`，
 * 因为业务单据（挂单状态）与账务必须同生共死，不能各开各的事务。
 * 本服务**不获取任何锁**：调用方（`MarketService`）已持挂单级 Redis 锁。
 */
@Injectable()
export class TradeSettlementService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountService,
    private readonly risk: TradeRiskService,
  ) {}

  /**
   * 成交分账。`fromFrozen` 区分买家的钱是「可用余额」（一价）还是「冻结余额」（竞价）。
   */
  async settleTrade(
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
  async unwind(
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
  async refundBid(
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

  /** 某挂单当前全部活跃出价（可排除指定一条，用于结算时退还落败者）。 */
  async activeBids(
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
}
