import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MARKETING_POINT } from '../../ledger/ledger.types';
import { Repository } from 'typeorm';
import { ClockService } from '../../common/clock/clock.service';
import { EconomyService } from '../../economy/economy.service';
import { RedeemOrder } from '../../entities/redeem-order.entity';
import { AdminExchangeService } from './admin-exchange.service';

/** 固定时钟，便于断言履约时间被写进了独立列。 */
const NOW = new Date('2026-08-26T10:00:00Z');

/**
 * 履约状态机的并发约束。
 *
 * 这组用例的意义在于锁住「条件更新 + 检查影响行数」这个写法：
 * 一旦有人改回「findOne 读状态 → save 整实体」，下面的用例会失败。
 * 那个写法在两个运营同时操作一张订单时两边都成功，后果是实物发出 + 积分退回。
 */
describe('AdminExchangeService 履约状态机', () => {
  interface OrdersStub {
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    update: jest.Mock;
  }
  interface EconomyStub {
    apply: jest.Mock;
  }

  let orders: OrdersStub;
  let economy: EconomyStub;
  let svc: AdminExchangeService;

  function order(over: Partial<RedeemOrder> = {}): RedeemOrder {
    return {
      id: 'o1',
      userId: 'u1',
      exchangeKey: 'coupon_5',
      itemName: '5 元代金券',
      itemType: 'virtual',
      cost: 500,
      assetCode: MARKETING_POINT,
      status: 'pending',
      bizId: 'b1',
      address: null,
      trackingNo: null,
      shippedAt: null,
      cancelledAt: null,
      remark: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
  }

  beforeEach(() => {
    orders = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    economy = {
      apply: jest.fn(() =>
        Promise.resolve({
          wallet: { gameCoin: 0, marketingPoint: 500 },
          entry: {},
          duplicated: false,
        }),
      ),
    };
    svc = new AdminExchangeService(
      orders as unknown as Repository<RedeemOrder>,
      economy as unknown as EconomyService,
      { now: () => NOW } as unknown as ClockService,
    );
  });

  describe('ship 发货', () => {
    it('状态流转走条件更新，条件里必须带 status=pending', async () => {
      orders.findOne.mockResolvedValue(order({ status: 'shipped' }));

      await svc.ship('o1', { trackingNo: 'SF123' });

      expect(orders.update).toHaveBeenCalledWith(
        { id: 'o1', status: 'pending' },
        expect.objectContaining({ status: 'shipped', trackingNo: 'SF123' }),
      );
    });

    it('抢不到状态（并发已被取消）：400，且带上当前状态便于运营判断', async () => {
      orders.update.mockResolvedValue({ affected: 0 });
      orders.findOne.mockResolvedValue(order({ status: 'cancelled' }));

      await expect(svc.ship('o1', {})).rejects.toThrow(/当前状态：cancelled/);
    });

    it('订单不存在：404 而不是 400', async () => {
      orders.update.mockResolvedValue({ affected: 0 });
      orders.findOne.mockResolvedValue(null);

      await expect(svc.ship('nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('发货时间写进独立列，不依赖 updated_at', async () => {
      orders.findOne.mockResolvedValue(order({ status: 'shipped' }));

      await svc.ship('o1', { trackingNo: 'SF123' });

      expect(orders.update).toHaveBeenCalledWith(
        { id: 'o1', status: 'pending' },
        expect.objectContaining({ shippedAt: NOW }),
      );
    });
  });

  describe('cancel 取消退款', () => {
    it('pending：先抢状态再退款', async () => {
      orders.findOne.mockResolvedValue(order());

      await svc.cancel('o1', { reason: '缺货' });

      expect(orders.update).toHaveBeenCalledWith(
        { id: 'o1', status: 'pending' },
        expect.objectContaining({
          status: 'cancelled',
          remark: '缺货',
          cancelledAt: NOW,
        }),
      );
      expect(economy.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          bizId: 'refund:o1',
          delta: 500,
          assetCode: MARKETING_POINT,
        }),
      );
    });

    it('并发发货抢先：拒绝取消且**不退款**（否则货已发还退钱）', async () => {
      orders.findOne
        .mockResolvedValueOnce(order({ status: 'pending' })) // 进入时读到的旧状态
        .mockResolvedValue(order({ status: 'shipped' })); // 抢锁失败后读到的真实状态
      orders.update.mockResolvedValue({ affected: 0 });

      await expect(svc.cancel('o1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(economy.apply).not.toHaveBeenCalled();
    });

    it('已 cancelled：重入补退款（退款幂等键兜住，不会退两次）', async () => {
      orders.findOne.mockResolvedValue(order({ status: 'cancelled' }));

      await svc.cancel('o1', {});

      // 状态已是终态，不再尝试流转，但退款要再发一次（ledger 唯一键保证不重复）
      expect(orders.update).not.toHaveBeenCalled();
      expect(economy.apply).toHaveBeenCalledWith(
        expect.objectContaining({ bizId: 'refund:o1' }),
      );
    });

    it('已 shipped：拒绝取消', async () => {
      orders.findOne.mockResolvedValue(order({ status: 'shipped' }));

      await expect(svc.cancel('o1', {})).rejects.toThrow(/仅待处理订单可取消/);
      expect(economy.apply).not.toHaveBeenCalled();
    });
  });
});
