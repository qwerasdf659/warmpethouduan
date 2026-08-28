import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MARKETING_POINT } from '../ledger/ledger.types';
import { PromoService } from './promo.service';
import type { ClockService } from '../common/clock/clock.service';
import type { GameConfigService } from '../config/game-config.service';
import type { EconomyService } from '../economy/economy.service';
import type { PromoCode } from '../entities/promo-code.entity';
import type { PromoRedemption } from '../entities/promo-redemption.entity';
import type { Repository } from 'typeorm';
import type Redis from 'ioredis';

const NOW = new Date('2026-08-26T04:00:00.000Z');

/**
 * 桩只声明各用例真正用到的方法：将来 PromoService 的依赖签名变了，
 * 这里会编译报错而不是静默测一个空壳。
 */
interface TxManagerStub {
  query: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

function makeCode(over: Partial<PromoCode> = {}): PromoCode {
  return {
    id: '1',
    code: 'ABCDEF2345',
    batch: '测试批次',
    assetCode: MARKETING_POINT,
    amount: 888,
    maxUses: 2,
    usedCount: 0,
    expiresAt: null,
    enabled: true,
    remark: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function setup(opts: {
  /** `UPDATE ... RETURNING` 的**原始**返回值，直接照搬真实驱动的形状 */
  updateResult: unknown;
  existing?: PromoRedemption | null;
  row?: PromoCode | null;
}) {
  const mgr: TxManagerStub = {
    query: jest.fn(() => Promise.resolve(opts.updateResult)),
    create: jest.fn((_e: unknown, v: unknown) => v),
    save: jest.fn((v: unknown) =>
      Promise.resolve({ id: '9', ...(v as object) }),
    ),
  };

  const codes = {
    findOne: jest.fn(() =>
      Promise.resolve(opts.row === undefined ? makeCode() : opts.row),
    ),
    manager: {
      transaction: jest.fn((cb: (m: TxManagerStub) => Promise<unknown>) =>
        cb(mgr),
      ),
    },
  };

  const redemptions = {
    findOne: jest.fn(() => Promise.resolve(opts.existing ?? null)),
  };

  const economy = {
    apply: jest.fn(() =>
      Promise.resolve({
        wallet: { gameCoin: 0, marketingPoint: 888 },
        entry: {},
        duplicated: false,
      }),
    ),
  };

  const config = {
    get: jest.fn(() =>
      Promise.resolve({ dailyFailLimit: 10, dailySuccessLimit: 5 }),
    ),
  };

  const clock = { now: jest.fn(() => NOW) };

  const redis = {
    get: jest.fn(() => Promise.resolve(null)),
    incr: jest.fn(() => Promise.resolve(1)),
    expire: jest.fn(() => Promise.resolve(1)),
  };

  const svc = new PromoService(
    codes as unknown as Repository<PromoCode>,
    redemptions as unknown as Repository<PromoRedemption>,
    economy as unknown as EconomyService,
    config as unknown as GameConfigService,
    clock as unknown as ClockService,
    redis as unknown as Redis,
  );

  return { svc, mgr, economy, codes, redemptions };
}

describe('PromoService.redeem', () => {
  /**
   * 回归：未命中的 `UPDATE ... RETURNING` 返回的是 `[[], 0]`（长度为 2），
   * 曾因此让 `res.length === 0` 恒为假 —— 用尽判断变成死代码，
   * 一个 `max_uses=1` 的线下码可以被任意多的玩家核销。
   */
  it('码已用尽时拒绝核销，且一分钱都不发', async () => {
    const { svc, economy } = setup({ updateResult: [[], 0] });

    await expect(svc.redeem('42', 'ABCDEF2345')).rejects.toThrow(
      BadRequestException,
    );
    expect(economy.apply).not.toHaveBeenCalled();
  });

  it('领用成功时按码面额入账，bizId 由码 id 派生', async () => {
    const { svc, economy } = setup({ updateResult: [[{ id: '1' }], 1] });

    const res = await svc.redeem('42', 'ABCDEF2345');

    expect(res.duplicated).toBe(false);
    expect(economy.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '42',
        assetCode: MARKETING_POINT,
        delta: 888,
        bizId: 'promo:1',
        reason: 'promo',
      }),
    );
  });

  it('同一玩家重复提交走幂等回放，不再占用次数', async () => {
    const { svc, mgr, economy } = setup({
      updateResult: [[{ id: '1' }], 1],
      existing: {
        id: '7',
        assetCode: MARKETING_POINT,
        amount: 888,
      } as PromoRedemption,
    });

    const res = await svc.redeem('42', 'ABCDEF2345');

    expect(res.duplicated).toBe(true);
    // 没有走条件自增，即没有再消耗一次 max_uses
    expect(mgr.query).not.toHaveBeenCalled();
    expect(economy.apply).toHaveBeenCalledTimes(1);
  });

  it('输入归一化：小写与连字符命中同一个码', async () => {
    const { svc, codes } = setup({ updateResult: [[{ id: '1' }], 1] });

    await svc.redeem('42', 'abcdef-2345');

    expect(codes.findOne).toHaveBeenCalledWith({
      where: { code: 'ABCDEF2345' },
    });
  });

  it('码不存在返回 404，且提示不区分「不存在」与「已失效」', async () => {
    const { svc, economy } = setup({ updateResult: [[], 0], row: null });

    await expect(svc.redeem('42', 'ABCDEF2345')).rejects.toThrow(
      NotFoundException,
    );
    expect(economy.apply).not.toHaveBeenCalled();
  });

  it('全是字符集外的字符时按格式错误拒绝', async () => {
    const { svc, codes } = setup({ updateResult: [[], 0] });

    // 0/1/I/L/O/U 都不在生码字符集里，归一化后是空串
    await expect(svc.redeem('42', '0110-ILOU')).rejects.toThrow(
      BadRequestException,
    );
    expect(codes.findOne).not.toHaveBeenCalled();
  });
});
