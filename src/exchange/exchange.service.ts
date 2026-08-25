import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LockService } from '../common/lock/lock.service';
import { EconomyService, WalletView } from '../economy/economy.service';
import { RedeemOrder } from '../entities/redeem-order.entity';
import { AddressService } from './address.service';
import { EXCHANGE_ITEMS, getExchangeItem } from './exchange.config';
import { OrderQueryDto } from './dto/exchange.dto';

/**
 * 兑换中心：下单扣积分并落 pending 订单（实物由后台发货）。
 * 扣费经 EconomyService.apply（bizId 持久幂等），订单 (userId,bizId) 唯一，
 * 双提交回放同一订单、不重复扣费。
 */
@Injectable()
export class ExchangeService {
  constructor(
    @InjectRepository(RedeemOrder)
    private readonly orders: Repository<RedeemOrder>,
    private readonly economy: EconomyService,
    private readonly address: AddressService,
    private readonly lock: LockService,
  ) {}

  /** 兑换目录 + 当前余额。 */
  async list(userId: string): Promise<{
    items: typeof EXCHANGE_ITEMS;
    wallet: WalletView;
  }> {
    return {
      items: EXCHANGE_ITEMS,
      wallet: await this.economy.getWallet(userId),
    };
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
    const item = getExchangeItem(exchangeKey);
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
      const applied = await this.economy.apply({
        userId,
        pool: item.pool,
        delta: -item.cost,
        bizId: `redeem:${bizId}`,
        reason: 'exchange',
        refId: item.key,
      });

      // 幂等回放：返回既有订单，不重复建单
      if (applied.duplicated) {
        const existing = await this.orders.findOne({
          where: { userId, bizId },
        });
        if (existing) return { order: existing, wallet: applied.wallet };
      }

      const order = await this.orders.save(
        this.orders.create({
          userId,
          exchangeKey: item.key,
          itemName: item.name,
          itemType: item.type,
          cost: item.cost,
          pool: item.pool,
          status: 'pending',
          bizId,
          address: addressSnapshot,
          trackingNo: null,
          remark: null,
        }),
      );
      return { order, wallet: applied.wallet };
    });
  }
}
