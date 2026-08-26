import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClockService } from '../common/clock/clock.service';
import { GameConfigService } from '../config/game-config.service';
import { TradeRiskService } from './trade-risk.service';

const NOW = new Date('2026-08-27T04:00:00Z');

const DEFAULT_CONFIG: Record<string, unknown> = {
  'market.enabled': true,
  'market.features': {
    recycle: true,
    gift: true,
    listing: true,
    auction: true,
  },
  'market.risk': {
    minAccountAgeDays: 7,
    maxTradesPerDay: 3,
    maxValuePerDay: 1000,
    abnormalPriceRatio: 5,
  },
  'market.priceBand': { enabled: true, minBps: 3000, maxBps: 30000 },
};

/**
 * 风控是交易功能的准入层。这里逐条测「什么情况下应该拒绝」——
 * 每一条对应风控清单里的一项（R1/R3/R6/R10），
 * 而它们存在的前提是一个判断：第三档不做风控，打金工作室三个月就能毁掉经济系统。
 */
describe('TradeRiskService', () => {
  let overrides: Record<string, unknown>;
  let query: jest.Mock;
  let svc: TradeRiskService;

  const clock: ClockService = { now: () => NOW, nowMs: () => NOW.getTime() };

  beforeEach(() => {
    overrides = {};
    query = jest.fn().mockResolvedValue([]);
    const config = {
      get: (key: string) =>
        Promise.resolve(
          key in overrides ? overrides[key] : DEFAULT_CONFIG[key],
        ),
    } as unknown as GameConfigService;
    svc = new TradeRiskService(
      { query } as unknown as DataSource,
      config,
      clock,
    );
  });

  /** R10：出事能一键关停市场。 */
  describe('assertEnabled', () => {
    it('总开关关闭时一律拒绝', async () => {
      overrides['market.enabled'] = false;
      await expect(svc.assertEnabled('gift')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('总开关开着但分档未开时拒绝该档', async () => {
      overrides['market.features'] = {
        recycle: true,
        gift: false,
        listing: false,
        auction: false,
      };
      await expect(svc.assertEnabled('gift')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(svc.assertEnabled('recycle')).resolves.toBeUndefined();
    });

    it('两个开关都开时放行', async () => {
      await expect(svc.assertEnabled('auction')).resolves.toBeUndefined();
    });
  });

  /** R1：新账号交易冷却，拦「注册一批小号立刻汇给大号」。 */
  describe('assertAccountAge', () => {
    const registeredDaysAgo = (days: number) => {
      query.mockResolvedValue([
        { created_at: new Date(NOW.getTime() - days * 86_400_000) },
      ]);
    };

    it('注册未满阈值时拒绝', async () => {
      registeredDaysAgo(3);
      await expect(svc.assertAccountAge('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('注册已满阈值时放行', async () => {
      registeredDaysAgo(8);
      await expect(svc.assertAccountAge('u1')).resolves.toBeUndefined();
    });

    it('阈值为 0 时完全跳过（连查都不查）', async () => {
      overrides['market.risk'] = {
        ...(DEFAULT_CONFIG['market.risk'] as object),
        minAccountAgeDays: 0,
      };
      await expect(svc.assertAccountAge('u1')).resolves.toBeUndefined();
      expect(query).not.toHaveBeenCalled();
    });

    it('玩家不存在时拒绝', async () => {
      query.mockResolvedValue([]);
      await expect(svc.assertAccountAge('u404')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  /** R3：单日笔数与金额上限。 */
  describe('assertDailyQuota', () => {
    it('未用过额度时放行', async () => {
      query.mockResolvedValue([]);
      await expect(svc.assertDailyQuota('a1', 500)).resolves.toBeUndefined();
    });

    it('笔数已达上限时拒绝', async () => {
      query.mockResolvedValue([{ trade_count: 3, trade_value: '0' }]);
      await expect(svc.assertDailyQuota('a1', 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    /** 判的是「加上本笔之后是否超」，而不是「已用是否超」。 */
    it('本笔会让金额越界时拒绝', async () => {
      query.mockResolvedValue([{ trade_count: 1, trade_value: '900' }]);
      await expect(svc.assertDailyQuota('a1', 200)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(svc.assertDailyQuota('a1', 100)).resolves.toBeUndefined();
    });
  });

  /**
   * R6：限价区间。下限比上限更重要 ——「1 币挂一件高价皮肤」是站外私下交易的
   * 标准手法（站外微信转账，站内用荒谬低价完成交割）。
   */
  describe('assertPriceBand', () => {
    it('区间内放行（参考价 1000 → 300~3000）', async () => {
      await expect(svc.assertPriceBand(1000, 300)).resolves.toBeUndefined();
      await expect(svc.assertPriceBand(1000, 3000)).resolves.toBeUndefined();
    });

    it('低于下限拒绝（堵住站外交易通道）', async () => {
      await expect(svc.assertPriceBand(1000, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('高于上限拒绝', async () => {
      await expect(svc.assertPriceBand(1000, 3001)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('关闭限价时不拦', async () => {
      overrides['market.priceBand'] = {
        enabled: false,
        minBps: 3000,
        maxBps: 30000,
      };
      await expect(svc.assertPriceBand(1000, 1)).resolves.toBeUndefined();
    });

    /** 参考价为 0（免费物品/没配价）时无从比较，放行交由 R5 告警兜。 */
    it('参考价为 0 时不拦', async () => {
      await expect(svc.assertPriceBand(0, 99999)).resolves.toBeUndefined();
    });
  });

  /** R5：只告警不拦截 —— 告警的读者是人，宁可宽松。 */
  describe('warnIfAbnormalPrice', () => {
    it('倍率越界只打日志，不抛异常', async () => {
      await expect(
        svc.warnIfAbnormalPrice('skin_tiger', 1000, 100_000, 'u1'),
      ).resolves.toBeUndefined();
      await expect(
        svc.warnIfAbnormalPrice('skin_tiger', 1000, 1, 'u1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('record', () => {
    it('用 UPSERT 累加笔数、金额与净流出', async () => {
      const m = { query: jest.fn().mockResolvedValue([]) };
      await svc.record(m as never, 'a1', 500, -500);

      const [sql, params] = (m.query.mock.calls as unknown[][])[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('trade_count');
      // 东八区业务日：UTC 04:00 已是当地 12:00，同一天
      expect(params).toEqual(['a1', '2026-08-27', 500, -500]);
    });
  });
});
