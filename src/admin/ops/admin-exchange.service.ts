import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClockService } from '../../common/clock/clock.service';
import { EconomyService } from '../../economy/economy.service';
import { RedeemOrder } from '../../entities/redeem-order.entity';
import {
  CancelOrderDto,
  QueryOrdersDto,
  ShipOrderDto,
} from './dto/admin-exchange.dto';

/**
 * 兑换订单履约管理：查询 / 发货 / 取消退款。
 *
 * 状态流转一律用**条件更新**（`WHERE id = ? AND status = 'pending'` + 检查影响行数），
 * 不用「先读状态再整实体 save」。后者在两个运营同时操作一张订单时两边都会成功：
 * 发货方以为发货成功去了仓库，取消方退了积分并把状态改回 cancelled、物流单号被覆盖，
 * 结果是实物发出 + 积分退回，且库里查不到发货痕迹。
 */
@Injectable()
export class AdminExchangeService {
  constructor(
    @InjectRepository(RedeemOrder)
    private readonly orders: Repository<RedeemOrder>,
    private readonly economy: EconomyService,
    private readonly clock: ClockService,
  ) {}

  async list(
    q: QueryOrdersDto,
  ): Promise<{ list: RedeemOrder[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.userId) where.userId = q.userId;
    const [list, total] = await this.orders.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { list, total };
  }

  /** 发货/发放：pending → shipped，记录物流单号。 */
  async ship(id: string, dto: ShipOrderDto): Promise<{ order: RedeemOrder }> {
    const patch: Partial<RedeemOrder> = {
      status: 'shipped',
      trackingNo: dto.trackingNo ?? null,
      shippedAt: this.clock.now(),
    };
    if (dto.remark !== undefined) patch.remark = dto.remark;

    const res = await this.orders.update({ id, status: 'pending' }, patch);
    if (!res.affected) {
      // 没抢到状态：要么订单不存在，要么已被并发的发货/取消改掉
      const fresh = await this.orders.findOne({ where: { id } });
      if (!fresh) throw new NotFoundException('订单不存在');
      throw new BadRequestException(
        `仅待处理订单可发货（当前状态：${fresh.status}）`,
      );
    }
    return { order: await this.mustFind(id) };
  }

  /**
   * 取消并退款：pending → cancelled，按原池退回花费。
   *
   * 先抢状态、后退款。退款用 `bizId = refund:{orderId}`，靠 ledger 唯一键做持久幂等，
   * 因此「已 cancelled 但退款那步失败」的订单可以再调一次本接口补退，不会退两次。
   */
  async cancel(
    id: string,
    dto: CancelOrderDto,
  ): Promise<{ order: RedeemOrder }> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('订单不存在');

    if (order.status === 'pending') {
      const res = await this.orders.update(
        { id, status: 'pending' },
        {
          status: 'cancelled',
          remark: dto.reason ?? '运营取消并退款',
          cancelledAt: this.clock.now(),
        },
      );
      if (!res.affected) {
        const fresh = await this.mustFind(id);
        // 并发的发货抢先了：此时绝不能退款，否则货已发还退钱
        if (fresh.status !== 'cancelled') {
          throw new BadRequestException(
            `订单状态已变更，无法取消（当前状态：${fresh.status}）`,
          );
        }
      }
    } else if (order.status !== 'cancelled') {
      throw new BadRequestException(
        `仅待处理订单可取消（当前状态：${order.status}）`,
      );
    }

    await this.economy.apply({
      userId: order.userId,
      assetCode: order.assetCode,
      delta: order.cost,
      bizId: `refund:${order.id}`,
      reason: 'compensation',
      refId: order.exchangeKey,
    });

    return { order: await this.mustFind(id) };
  }

  private async mustFind(id: string): Promise<RedeemOrder> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }
}
