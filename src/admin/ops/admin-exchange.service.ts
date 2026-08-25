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

/** 兑换订单履约管理：查询 / 发货 / 取消退款。 */
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
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'pending') {
      throw new BadRequestException('仅待处理订单可发货');
    }
    order.status = 'shipped';
    order.trackingNo = dto.trackingNo ?? null;
    if (dto.remark !== undefined) order.remark = dto.remark;
    return { order: await this.orders.save(order) };
  }

  /** 取消并退款：pending → cancelled，按原池退回花费。 */
  async cancel(
    id: string,
    dto: CancelOrderDto,
  ): Promise<{ order: RedeemOrder }> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'pending') {
      throw new BadRequestException('仅待处理订单可取消');
    }

    // 退款（bizId=refund:{orderId} 持久幂等，防重复退）
    await this.economy.apply({
      userId: order.userId,
      pool: order.pool,
      delta: order.cost,
      bizId: `refund:${order.id}`,
      reason: 'compensation',
      refId: order.exchangeKey,
    });

    order.status = 'cancelled';
    order.remark = dto.reason ?? '运营取消并退款';
    return { order: await this.orders.save(order) };
  }
}
