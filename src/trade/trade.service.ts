import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { rowsOf } from '../common/db/query-result';
import { LockService } from '../common/lock/lock.service';
import { BUSINESS_TZ } from '../common/time/business-day';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { TradeOffer } from '../entities/trade-offer.entity';
import { TradeOfferItem, TradeSide } from '../entities/trade-offer-item.entity';
import { AccountService } from '../ledger/account.service';
import { InventoryService } from '../ledger/inventory.service';
import { LedgerService } from '../ledger/ledger.service';
import { GAME_COIN, InstanceMove, Leg } from '../ledger/ledger.types';
import { HoldingCleanupService } from '../trading/holding-cleanup.service';
import { SubjectResolverService } from '../trading/subject-resolver.service';
import { TradeRiskService } from '../trading/trade-risk.service';
import type { ResolvedSubject, Subject } from '../trading/trading.types';

export interface TradeItemInput {
  assetCode?: string;
  qty?: number;
  instanceId?: string;
}

export interface OfferView {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
  fromCoin: number;
  toCoin: number;
  fromItems: TradeItemInput[];
  toItems: TradeItemInput[];
  expiresAt: string;
  remainSec: number;
  createdAt: string;
}

/**
 * 双向易货（barter）。
 *
 * 易货与市场共用 `TradingModule` 的三道闸，一道都不能省：
 *  - `SubjectResolverService`：可交易性、获得冷却、归属、挂单中状态；
 *  - `TradeRiskService`：分档开关、账号年龄、日额度、两侧估值对等；
 *  - `HoldingCleanupService`：成交后把换走的物品从穿戴与摆放里摘掉。
 * 这条路径自己实现一套的话，`tradable=false` 的扭蛋产出就能从易货自由转手，
 * 把市场侧的红线整条绕开。
 *
 * 限价在易货里的等价物是 `assertValuationBand`：对价是任意物品组合、没有单价可比，
 * 因此改判「两侧估值不能悬殊」。
 *
 * 「进场」（建单 / 接受）受总闸 + `market.features.trade` 约束；
 * 「退出」（撤销 / 拒绝 / 超时）不受约束——关闸是为了止血，不是把冻结的资产锁死。
 */
@Injectable()
export class TradeService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ledger: LedgerService,
    private readonly economy: EconomyService,
    private readonly config: GameConfigService,
    private readonly clock: ClockService,
    private readonly lock: LockService,
    private readonly subjects: SubjectResolverService,
    private readonly risk: TradeRiskService,
    private readonly cleanup: HoldingCleanupService,
    private readonly accounts: AccountService,
    private readonly inventory: InventoryService,
  ) {}

  private validateItems(items: TradeItemInput[], max: number): void {
    if (items.length > max) {
      throw new BadRequestException(`单侧物品项数不能超过 ${max}`);
    }
    for (const it of items) {
      const hasInstance = !!it.instanceId;
      const hasStack = !!it.assetCode;
      if (hasInstance === hasStack) {
        throw new BadRequestException(
          'instanceId 与 assetCode 只能传一个：唯一物品按实例，可堆叠按件数',
        );
      }
      if (hasStack && (!it.qty || it.qty <= 0)) {
        throw new BadRequestException('可堆叠标的必须带正整数 qty');
      }
    }
  }

  private subjectOf(it: TradeItemInput): Subject {
    if (it.instanceId) return { instanceId: it.instanceId };
    if (it.assetCode && it.qty) {
      return { assetCode: it.assetCode, qty: it.qty };
    }
    throw new BadRequestException('标的格式非法');
  }

  private inputOf(row: TradeOfferItem): TradeItemInput {
    return {
      assetCode: row.assetCode ?? undefined,
      qty: row.qty != null ? Number(row.qty) : undefined,
      instanceId: row.instanceId ?? undefined,
    };
  }

  /**
   * 校验一侧标的当前确实归 `ownerUserId` 所有、且允许玩家间流转。
   *
   * 必须在幂等回放判定**之后**调用：重复提交时发起方的标的已经在 ESCROW 里，
   * 再查一次归属必然失败，会把一次正常的重试变成报错。
   */
  /** 一侧的估值：标的参考价之和 + 附带的币。用于估值对等与日额度累计。 */
  private sideValue(subjects: ResolvedSubject[], coin: number): number {
    return subjects.reduce((sum, s) => sum + s.referenceValue, 0) + coin;
  }

  /**
   * 已冻结一侧的估值。
   *
   * 不能走 `resolveSide`：发起方的标的在建单时就转到 ESCROW 了，按 userId 查归属
   * 必然落空。所以这里只查目录价，不查归属——归属在建单时已经验过一次。
   *
   * 唯一物品的 `asset_code` 不落在报价明细行上（那一行只有 instanceId），
   * 因此要回查 `item_instance` 才能拿到计价用的资产码。
   */
  private async frozenSideValue(
    items: TradeOfferItem[],
    coin: number,
  ): Promise<number> {
    let sum = coin;
    for (const it of items) {
      if (it.assetCode && it.qty) {
        const def = await this.subjects.requireDef(it.assetCode, false);
        sum += def.price * Number(it.qty);
      } else if (it.instanceId) {
        const rows = rowsOf<{ asset_code: string }>(
          await this.ds.query(
            `SELECT "asset_code" FROM "item_instance" WHERE "id" = $1`,
            [it.instanceId],
          ),
        );
        if (!rows[0]) continue;
        const def = await this.subjects.requireDef(rows[0].asset_code, false);
        sum += def.price;
      }
    }
    return sum;
  }

  /** 成交/解冻后把换走的物品从穿戴与摆放里摘掉。 */
  private async cleanupAfterOutflow(
    userId: string,
    assetCodes: string[],
  ): Promise<void> {
    for (const code of new Set(assetCodes)) {
      const remaining = await this.inventory.ownedQty(userId, code);
      await this.cleanup.settle(userId, code, remaining);
    }
  }

  private async resolveSide(
    ownerUserId: string,
    items: TradeItemInput[],
  ): Promise<ResolvedSubject[]> {
    const out: ResolvedSubject[] = [];
    for (const it of items) {
      out.push(
        await this.subjects.resolve(ownerUserId, this.subjectOf(it), {
          requireTradable: true,
        }),
      );
    }
    return out;
  }

  /** 冻结/托管一侧的资产（建单：进场；解冻则反向）。 */
  private freezeLegs(
    userId: string,
    coin: number,
    items: TradeOfferItem[],
    reverse: boolean,
  ): { legs: Leg[]; moves: InstanceMove[] } {
    const sign = reverse ? -1 : 1;
    const legs: Leg[] = [];
    const moves: InstanceMove[] = [];
    if (coin > 0) {
      legs.push({
        account: { userId },
        assetCode: GAME_COIN,
        delta: -sign * coin,
        frozenDelta: sign * coin,
      });
    }
    for (const it of items) {
      if (it.assetCode && it.qty) {
        const qty = Number(it.qty);
        legs.push({
          account: { userId },
          assetCode: it.assetCode,
          delta: -sign * qty,
          frozenDelta: sign * qty,
        });
      } else if (it.instanceId) {
        moves.push({
          instanceId: it.instanceId,
          from: reverse ? { systemCode: 'ESCROW' } : { userId },
          to: reverse ? { userId } : { systemCode: 'ESCROW' },
          resetCooldown: false,
        });
      }
    }
    return { legs, moves };
  }

  // ---------------------------------------------------------------- 建单

  async offer(
    fromUserId: string,
    bizId: string,
    toUserId: string,
    fromItems: TradeItemInput[],
    toItems: TradeItemInput[],
    fromCoin: number,
    toCoin: number,
  ): Promise<{ offer: OfferView; wallet: WalletView; duplicated: boolean }> {
    if (fromUserId === toUserId) {
      throw new BadRequestException('不能与自己交易');
    }
    await this.risk.assertEnabled('trade');
    // R1 双侧都查账龄：只查发起方的话，「养号发起 → 新号接受」照样能把资源
    // 汇进新号，而洗号流水线两头都要用号
    await this.risk.assertAccountAge(fromUserId);
    await this.risk.assertAccountAge(toUserId);

    const rules = await this.config.get('trade.rules');
    this.validateItems(fromItems, rules.maxItemsPerSide);
    this.validateItems(toItems, rules.maxItemsPerSide);

    return this.lock.withLock(`trade:${fromUserId}`, async () => {
      const now = this.clock.now();
      const existing = await this.ds
        .getRepository(TradeOffer)
        .findOne({ where: { fromUserId, bizId } });
      if (existing) {
        return {
          offer: await this.viewOf(existing, now),
          wallet: await this.economy.getWallet(fromUserId),
          duplicated: true,
        };
      }

      // 双侧都校验：发起方这一侧当场冻结，接受方那一侧提前拦掉「对方根本没有」
      // 与「该物品不可交易」，免得报价单挂满 24 小时才在接受时失败
      const fromSubjects = await this.resolveSide(fromUserId, fromItems);
      const toSubjects = await this.resolveSide(toUserId, toItems);

      // R6 的易货版：两侧估值不能悬殊（限价在易货里的等价物）
      const fromValue = this.sideValue(fromSubjects, fromCoin);
      const toValue = this.sideValue(toSubjects, toCoin);
      await this.risk.assertValuationBand(fromValue, toValue);

      // R3 日额度按发起方的付出侧计。额度在**接受**时才真正记账（见 settle），
      // 这里只做准入判断，否则挂着不被接受的报价单也会吃掉额度
      const fromAccount = await this.accounts.resolve({ userId: fromUserId });
      await this.risk.assertDailyQuota(fromAccount, fromValue);

      const expiresAt = new Date(now.getTime() + rules.expireHours * 3_600_000);

      const offer = await this.ds.transaction(async (m) => {
        const created = await m.getRepository(TradeOffer).save(
          m.getRepository(TradeOffer).create({
            fromUserId,
            toUserId,
            status: 'pending',
            fromCoin: String(fromCoin),
            toCoin: String(toCoin),
            expiresAt,
            bizId,
          }),
        );
        const rows: TradeOfferItem[] = [];
        for (const it of fromItems)
          rows.push(this.itemRow(m, created.id, 'from', it));
        for (const it of toItems)
          rows.push(this.itemRow(m, created.id, 'to', it));
        if (rows.length) await m.getRepository(TradeOfferItem).save(rows);

        // 冻结发起方一侧（进场）
        const fromRows = rows.filter((r) => r.side === 'from');
        const { legs, moves } = this.freezeLegs(
          fromUserId,
          fromCoin,
          fromRows,
          false,
        );
        if (legs.length || moves.length) {
          await this.ledger.postWithin(
            m,
            {
              kind: 'freeze',
              reason: 'trade_offer',
              bizKey: `trade:offer:${created.id}`,
              scope: 'user',
              actorUserId: fromUserId,
              legs,
              instanceMoves: moves,
              refType: 'trade_offer',
              refId: created.id,
            },
            `trade:offer:${created.id}`,
          );
        }
        return created;
      });

      // 建单即把标的冻进 ESCROW，等同于离手：不清理的话，挂进易货的皮肤
      // 还穿在宠物身上、家具还在贡献舒适度。撤销/过期时资产退回，
      // 那条路径不需要反向补回穿戴——玩家自己重新穿即可，与挂单一致。
      await this.cleanupAfterOutflow(
        fromUserId,
        fromSubjects.map((s) => s.assetCode),
      );

      return {
        offer: await this.viewOf(offer, now),
        wallet: await this.economy.getWallet(fromUserId),
        duplicated: false,
      };
    });
  }

  private itemRow(
    m: EntityManager,
    offerId: string,
    side: TradeSide,
    it: TradeItemInput,
  ): TradeOfferItem {
    return m.getRepository(TradeOfferItem).create({
      offerId,
      side,
      assetCode: it.assetCode ?? null,
      qty: it.qty != null ? String(it.qty) : null,
      instanceId: it.instanceId ?? null,
    });
  }

  // ---------------------------------------------------------------- 收件箱

  async inbox(
    userId: string,
    box: 'incoming' | 'outgoing',
    page: number,
    pageSize: number,
  ): Promise<{ list: OfferView[]; total: number }> {
    const where =
      box === 'incoming' ? { toUserId: userId } : { fromUserId: userId };
    const [rows, total] = await this.ds.getRepository(TradeOffer).findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const now = this.clock.now();
    const list = [];
    for (const r of rows) list.push(await this.viewOf(r, now));
    return { list, total };
  }

  // ---------------------------------------------------------------- 响应

  async respond(
    userId: string,
    bizId: string,
    offerId: string,
    action: 'accept' | 'reject',
  ): Promise<{ offer: OfferView; wallet: WalletView; duplicated: boolean }> {
    return this.lock.withLock(`trade:${userId}`, async () => {
      const repo = this.ds.getRepository(TradeOffer);
      const offer = await repo.findOne({
        where: { id: offerId, toUserId: userId },
      });
      if (!offer) throw new NotFoundException('报价单不存在');
      const now = this.clock.now();

      if (offer.status !== 'pending') {
        // 幂等：已终态直接回放
        return {
          offer: await this.viewOf(offer, now),
          wallet: await this.economy.getWallet(userId),
          duplicated: true,
        };
      }
      if (new Date(offer.expiresAt) <= now) {
        await this.unwindOffer(offer, 'expired');
        throw new BadRequestException('报价单已过期');
      }

      if (action === 'reject') {
        await this.unwindOffer(offer, 'rejected');
      } else {
        await this.risk.assertEnabled('trade');
        await this.settle(offer);
      }
      const fresh = await repo.findOne({ where: { id: offerId } });
      return {
        offer: await this.viewOf(fresh!, now),
        wallet: await this.economy.getWallet(userId),
        duplicated: false,
      };
    });
  }

  async cancel(
    userId: string,
    bizId: string,
    offerId: string,
  ): Promise<{ offer: OfferView; duplicated: boolean }> {
    return this.lock.withLock(`trade:${userId}`, async () => {
      const repo = this.ds.getRepository(TradeOffer);
      const offer = await repo.findOne({
        where: { id: offerId, fromUserId: userId },
      });
      if (!offer) throw new NotFoundException('报价单不存在');
      const now = this.clock.now();
      if (offer.status !== 'pending') {
        return { offer: await this.viewOf(offer, now), duplicated: true };
      }
      await this.unwindOffer(offer, 'cancelled');
      const fresh = await repo.findOne({ where: { id: offerId } });
      return { offer: await this.viewOf(fresh!, now), duplicated: false };
    });
  }

  // ---------------------------------------------------------------- 结算 / 解冻

  /** 接受：一笔原子 transfer，双向交割（退出通道，不受总闸阻断结算本身）。 */
  private async settle(offer: TradeOffer): Promise<void> {
    const items = await this.ds
      .getRepository(TradeOfferItem)
      .find({ where: { offerId: offer.id } });
    const fromItems = items.filter((i) => i.side === 'from');
    const toItems = items.filter((i) => i.side === 'to');
    const fromCoin = Number(offer.fromCoin);
    const toCoin = Number(offer.toCoin);

    // 接受方一侧直到此刻才交割，建单时的校验已经过期最多 24 小时：
    // 物品可能已被卖掉、挂单中，或运营把该资产下架成不可交易。
    // 发起方一侧不重查——它建单时就冻进 ESCROW 了，按 userId 查归属必然落空。
    const toSubjects = await this.resolveSide(
      offer.toUserId,
      toItems.map((i) => this.inputOf(i)),
    );

    const fromValue = await this.frozenSideValue(fromItems, fromCoin);
    const toValue = this.sideValue(toSubjects, toCoin);

    const fromAccount = await this.accounts.resolve({
      userId: offer.fromUserId,
    });
    const toAccount = await this.accounts.resolve({ userId: offer.toUserId });
    // R3：接受方的额度在此刻判（建单时判的是发起方）
    await this.risk.assertDailyQuota(toAccount, toValue);

    await this.ds.transaction(async (m) => {
      const legs: Leg[] = [];
      const moves: InstanceMove[] = [];

      // 发起方冻结的币 → 接受方
      if (fromCoin > 0) {
        legs.push(
          {
            account: { userId: offer.fromUserId },
            assetCode: GAME_COIN,
            frozenDelta: -fromCoin,
          },
          {
            account: { userId: offer.toUserId },
            assetCode: GAME_COIN,
            delta: fromCoin,
          },
        );
      }
      // 接受方的币 → 发起方（从可用余额）
      if (toCoin > 0) {
        legs.push(
          {
            account: { userId: offer.toUserId },
            assetCode: GAME_COIN,
            delta: -toCoin,
          },
          {
            account: { userId: offer.fromUserId },
            assetCode: GAME_COIN,
            delta: toCoin,
          },
        );
      }
      for (const it of fromItems) {
        if (it.assetCode && it.qty) {
          const qty = Number(it.qty);
          legs.push(
            {
              account: { userId: offer.fromUserId },
              assetCode: it.assetCode,
              frozenDelta: -qty,
            },
            {
              account: { userId: offer.toUserId },
              assetCode: it.assetCode,
              delta: qty,
            },
          );
        } else if (it.instanceId) {
          moves.push({
            instanceId: it.instanceId,
            from: { systemCode: 'ESCROW' },
            to: { userId: offer.toUserId },
            toState: 'held',
            resetCooldown: true,
          });
        }
      }
      for (const it of toItems) {
        if (it.assetCode && it.qty) {
          const qty = Number(it.qty);
          legs.push(
            {
              account: { userId: offer.toUserId },
              assetCode: it.assetCode,
              delta: -qty,
            },
            {
              account: { userId: offer.fromUserId },
              assetCode: it.assetCode,
              delta: qty,
            },
          );
        } else if (it.instanceId) {
          moves.push({
            instanceId: it.instanceId,
            from: { userId: offer.toUserId },
            to: { userId: offer.fromUserId },
            toState: 'held',
            resetCooldown: true,
          });
        }
      }

      const posted = await this.ledger.postWithin(
        m,
        {
          kind: 'transfer',
          reason: 'trade_offer',
          bizKey: `trade:settle:${offer.id}`,
          scope: 'user',
          actorUserId: offer.toUserId,
          legs,
          instanceMoves: moves,
          refType: 'trade_offer',
          refId: offer.id,
        },
        `trade:settle:${offer.id}`,
      );
      await m
        .getRepository(TradeOffer)
        .update(
          { id: offer.id, status: 'pending' },
          { status: 'accepted', settledTxnId: posted.txnId },
        );

      // R3/R4 额度与净流出必须与成交同事务：分开写的话「成交了但额度没记上」
      // 等于额度形同虚设，而这正是攻击者会反复触发的窗口。
      //
      // 与赠送不同，易货双方都是主动付出方，所以**各记各的付出额**，
      // 而不是只记发起方。净流出取差额：长期单向净流出才是洗号特征。
      await this.risk.record(m, fromAccount, fromValue, fromValue - toValue);
      await this.risk.record(m, toAccount, toValue, toValue - fromValue);
    });

    // 换走的物品要从穿戴与摆放里摘掉，否则卖掉的皮肤还穿在宠物身上、
    // 换走的家具继续贡献舒适度。双方都要清。
    await this.cleanupAfterOutflow(
      offer.fromUserId,
      await this.assetCodesOf(fromItems),
    );
    await this.cleanupAfterOutflow(
      offer.toUserId,
      await this.assetCodesOf(toItems),
    );
  }

  /** 报价明细行涉及的资产码（唯一物品要回查 `item_instance`）。 */
  private async assetCodesOf(items: TradeOfferItem[]): Promise<string[]> {
    const codes: string[] = [];
    for (const it of items) {
      if (it.assetCode) {
        codes.push(it.assetCode);
      } else if (it.instanceId) {
        const rows = rowsOf<{ asset_code: string }>(
          await this.ds.query(
            `SELECT "asset_code" FROM "item_instance" WHERE "id" = $1`,
            [it.instanceId],
          ),
        );
        if (rows[0]) codes.push(rows[0].asset_code);
      }
    }
    return codes;
  }

  /** 拒绝/撤销/超时：解冻发起方一侧并落终态（退出通道，不受总闸约束）。 */
  private async unwindOffer(
    offer: TradeOffer,
    status: 'rejected' | 'cancelled' | 'expired',
  ): Promise<void> {
    const items = await this.ds
      .getRepository(TradeOfferItem)
      .find({ where: { offerId: offer.id, side: 'from' } });
    await this.ds.transaction(async (m) => {
      const { legs, moves } = this.freezeLegs(
        offer.fromUserId,
        Number(offer.fromCoin),
        items,
        true,
      );
      if (legs.length || moves.length) {
        await this.ledger.postWithin(
          m,
          {
            kind: 'freeze',
            reason: 'trade_offer',
            bizKey: `trade:unwind:${offer.id}:${status}`,
            scope: 'user',
            actorUserId: offer.fromUserId,
            legs,
            instanceMoves: moves,
            refType: 'trade_offer',
            refId: offer.id,
          },
          `trade:unwind:${offer.id}:${status}`,
        );
      }
      await m
        .getRepository(TradeOffer)
        .update({ id: offer.id, status: 'pending' }, { status });
    });
  }

  // ---------------------------------------------------------------- 到期 cron

  @Cron('*/10 * * * *', { name: 'trade-expire', timeZone: BUSINESS_TZ })
  async expireCron(): Promise<void> {
    const now = this.clock.now();
    const stale = await this.ds
      .getRepository(TradeOffer)
      .createQueryBuilder('o')
      .where('o.status = :s', { s: 'pending' })
      .andWhere('o.expires_at <= :now', { now })
      .limit(200)
      .getMany();
    for (const offer of stale) {
      try {
        await this.unwindOffer(offer, 'expired');
      } catch (e) {
        if (!this.ledger.isDuplicateBizId(e)) throw e;
      }
    }
  }

  // ---------------------------------------------------------------- view

  private async viewOf(offer: TradeOffer, now: Date): Promise<OfferView> {
    const items = await this.ds
      .getRepository(TradeOfferItem)
      .find({ where: { offerId: offer.id } });
    const map = (side: TradeSide): TradeItemInput[] =>
      items.filter((i) => i.side === side).map((i) => this.inputOf(i));
    return {
      id: offer.id,
      fromUserId: offer.fromUserId,
      toUserId: offer.toUserId,
      status: offer.status,
      fromCoin: Number(offer.fromCoin),
      toCoin: Number(offer.toCoin),
      fromItems: map('from'),
      toItems: map('to'),
      expiresAt: new Date(offer.expiresAt).toISOString(),
      remainSec: Math.max(
        0,
        Math.floor(
          (new Date(offer.expiresAt).getTime() - now.getTime()) / 1000,
        ),
      ),
      createdAt: new Date(offer.createdAt).toISOString(),
    };
  }
}
