import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { LockService } from '../common/lock/lock.service';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { RedeemOrder } from '../entities/redeem-order.entity';
import { ItemsService } from '../items/items.service';
import { AddressService } from './address.service';
import { ExchangeItem, getExchangeItem } from './exchange.config';
import { OrderQueryDto } from './dto/exchange.dto';

/** 目录项 + 该玩家视角的余量。`null` 表示不限量。 */
export interface ExchangeItemView extends ExchangeItem {
  stockLeft: number | null;
  myLeft: number | null;
}

/**
 * 兑换中心：下单扣积分并落 pending 订单（实物由后台发货）。
 * 扣费经 EconomyService.apply（bizId 持久幂等），订单 (userId,bizId) 唯一，
 * 双提交回放同一订单、不重复扣费。
 *
 * 库存/限购的已用量都从 `redeem_order` 实时数出来（排除 cancelled），不存计数器：
 * 少一个会漂移的状态，取消订单也自动回库。代价是每次下单多一次 COUNT，
 * 靠 `idx_redeem_order_key_status` 兜住。
 */
@Injectable()
export class ExchangeService {
  private readonly logger = new Logger('Exchange');

  constructor(
    @InjectRepository(RedeemOrder)
    private readonly orders: Repository<RedeemOrder>,
    private readonly economy: EconomyService,
    private readonly address: AddressService,
    private readonly lock: LockService,
    private readonly config: GameConfigService,
    private readonly items: ItemsService,
    private readonly clock: ClockService,
  ) {}

  /** 兑换目录（含剩余库存与本人可兑余量）+ 当前余额。 */
  async list(userId: string): Promise<{
    items: ExchangeItemView[];
    wallet: WalletView;
  }> {
    const items = await this.config.get('exchange.items');
    const [globalUsed, myUsed] = await Promise.all([
      this.usedCountByKey(),
      this.usedCountByKey(userId),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        stockLeft:
          item.stock === null
            ? null
            : Math.max(0, item.stock - (globalUsed.get(item.key) ?? 0)),
        myLeft:
          item.perUserLimit === null
            ? null
            : Math.max(0, item.perUserLimit - (myUsed.get(item.key) ?? 0)),
      })),
      wallet: await this.economy.getWallet(userId),
    };
  }

  /**
   * 各兑换项的已占用件数（`status <> 'cancelled'`）。传 userId 则只数该玩家的。
   * 取消订单不计入 —— 库存与限购都由此自动回滚。
   */
  private async usedCountByKey(userId?: string): Promise<Map<string, number>> {
    const qb = this.orders
      .createQueryBuilder('o')
      .select('o.exchangeKey', 'key')
      .addSelect('COUNT(*)', 'used')
      .where('o.status <> :cancelled', { cancelled: 'cancelled' })
      .groupBy('o.exchangeKey');
    if (userId) qb.andWhere('o.userId = :userId', { userId });

    const rows = await qb.getRawMany<{ key: string; used: string }>();
    return new Map(rows.map((r) => [r.key, parseInt(r.used, 10)]));
  }

  /** 我的兑换订单（分页倒序）。 */
  async myOrders(
    userId: string,
    q: OrderQueryDto,
  ): Promise<{ list: RedeemOrder[]; total: number }> {
    const [list, total] = await this.orders.findAndCount({
      where: { userId },
      order: { id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { list, total };
  }

  /** 兑换下单。 */
  async redeem(
    userId: string,
    exchangeKey: string,
    bizId: string,
    addressId?: string,
  ): Promise<{ order: RedeemOrder; wallet: WalletView }> {
    const items = await this.config.get('exchange.items');
    const item = getExchangeItem(items, exchangeKey);
    if (!item) throw new BadRequestException('兑换项不存在');

    let addressSnapshot = null as RedeemOrder['address'];
    if (item.type === 'physical') {
      if (!addressId) throw new BadRequestException('实物兑换需选择收货地址');
      const addr = await this.address.getOwned(userId, addressId);
      addressSnapshot = {
        receiver: addr.receiver,
        phone: addr.phone,
        region: addr.region,
        detail: addr.detail,
      };
    }

    return this.lock.withLock(`pet:${userId}`, async () => {
      // 幂等回放要先于限购判断：否则「限购 1 件」的玩家重试同一 bizId 会被当成第二次兑换
      const replay = await this.orders.findOne({ where: { userId, bizId } });
      if (replay) {
        return { order: replay, wallet: await this.economy.getWallet(userId) };
      }

      // 限购在扣费之前判，常见的拒绝路径完全不碰钱（玩家级锁已保证本人串行）
      await this.assertPerUserLimit(userId, item);

      const applied = await this.economy.apply({
        userId,
        pool: item.pool,
        delta: -item.cost,
        bizId: `redeem:${bizId}`,
        reason: 'exchange',
        refId: item.key,
      });

      // 库存是跨玩家的共享资源，用兑换项级锁把「数 + 建单」串起来
      return this.lock.withLock(`exchange:${item.key}`, async () => {
        if (item.stock !== null) {
          const used = await this.orders.count({
            where: { exchangeKey: item.key, status: Not('cancelled') },
          });
          if (used >= item.stock) {
            // 扣费已成功但没货了：原路退回（退款幂等，重试同 bizId 也不会退两次）
            await this.economy.apply({
              userId,
              pool: item.pool,
              delta: item.cost,
              bizId: `redeem-oversold:${bizId}`,
              reason: 'compensation',
              refId: item.key,
            });
            throw new BadRequestException('该兑换项已兑完');
          }
        }

        const fulfilled = await this.autoFulfill(userId, item, bizId);
        const order = await this.orders.save(
          this.orders.create({
            userId,
            exchangeKey: item.key,
            itemName: item.name,
            itemType: item.type,
            cost: item.cost,
            pool: item.pool,
            status: fulfilled ? 'shipped' : 'pending',
            shippedAt: fulfilled ? this.clock.now() : null,
            bizId,
            address: addressSnapshot,
            trackingNo: null,
            remark: fulfilled ? '自动发放' : null,
          }),
        );
        return { order, wallet: applied.wallet };
      });
    });
  }

  /**
   * 虚拟品即时发放。返回 true = 已进背包，订单可直接落 shipped。
   *
   * 只有 `type='virtual'` 且配了 `grantItemKey` 才自动发；实物与需要线下核销的
   * 权益（如门店代金券）仍留 `pending` 等运营处理。
   *
   * 发放失败**不回滚订单**，而是落 pending 交给后台补发。留 pending 的代价是运营
   * 多点一次发货，但不会出现钱货两空。
   *
   * 发放的幂等键由订单 `bizId` 派生，因此重复调用不会多发一份 —— 这一点在重构前
   * 做不到（物品发放当时没有持久幂等键，只有 Redis 24h 窗口）。
   */
  private async autoFulfill(
    userId: string,
    item: ExchangeItem,
    bizId: string,
  ): Promise<boolean> {
    if (item.type !== 'virtual' || !item.grantItemKey || item.grantQty <= 0) {
      return false;
    }
    try {
      // 记账路径不再抢 Redis 锁，因此在 `pet:{userId}` 锁内直接调用是安全的。
      // 重构前这里必须用一个专门的 `grantUnlocked` 变体，否则持锁者会抢不到自己
      // 已持有的锁、抛 409、被下面的 catch 吞掉 —— 于是「即时到账」静默降级成
      // 人工发货。那个 bug 真实发生过，现在它的成因（双入口）已被消除。
      await this.items.grant(
        userId,
        item.grantItemKey,
        item.grantQty,
        `redeem:${bizId}`,
        'exchange',
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `兑换自动发放失败，订单转人工（${item.key} → ${item.grantItemKey}）: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  private async assertPerUserLimit(
    userId: string,
    item: ExchangeItem,
  ): Promise<void> {
    if (item.perUserLimit === null) return;
    const mine = await this.orders.count({
      where: { userId, exchangeKey: item.key, status: Not('cancelled') },
    });
    if (mine >= item.perUserLimit) {
      throw new BadRequestException(
        `该兑换项每人限兑 ${item.perUserLimit} 件，你已兑 ${mine} 件`,
      );
    }
  }
}
