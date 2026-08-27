import type { GameConfigService } from '../../config/game-config.service';
import { MARKET_CONFIG } from '../../market/market.config';
import type { MarketService } from '../../market/market.service';
import type { TradeRiskService } from '../../market/trade-risk.service';
import { AdminMarketService } from './admin-market.service';
import type {
  ForceCancelListingDto,
  QueryListingsDto,
} from './dto/market-admin.dto';

/**
 * 市场后台的三件事各有一条不能退化的约束：
 *
 * 1. `status()` 必须把 `MARKET_CONFIG` 的**每一项**都摊出来 —— 它是运营排查
 *    「为什么挂不上单」的第一站，漏掉一个旋钮就等于让人对着一个看不见的开关猜。
 * 2. `forceCancel()` 必须**委托** `MarketService`，不能自己实现拆单。
 * 3. `netFlow()` 的 days 默认值必须是 7（单看一天的赠送完全正常，跨天才有信号）。
 *
 * 端到端行为（真的退回标的、真的解冻出价、权限分离）由 e2e 覆盖，这里只锁契约。
 */
describe('AdminMarketService', () => {
  /** 按 key 造一份可辨识的假配置值，便于断言「哪一项被摊到了哪个字段」。 */
  const CONFIG_VALUES: Record<string, unknown> = {
    'market.enabled': true,
    'market.features': {
      recycle: true,
      gift: false,
      listing: true,
      auction: false,
    },
    'market.feeBps': 500,
    'market.listingHours': 72,
    'market.recycleRateBps': 3_000,
    'market.risk': {
      minAccountAgeDays: 7,
      maxTradesPerDay: 20,
      maxValuePerDay: 100_000,
      abnormalPriceRatio: 8,
    },
    'market.priceBand': { enabled: true, minBps: 5_000, maxBps: 100_000 },
  };

  let market: { adminListings: jest.Mock; forceCancel: jest.Mock };
  let risk: { netFlowAlerts: jest.Mock };
  let config: { get: jest.Mock };
  let svc: AdminMarketService;

  beforeEach(() => {
    market = {
      adminListings: jest.fn(() => Promise.resolve({ list: [], total: 0 })),
      forceCancel: jest.fn((id: string) =>
        Promise.resolve({ ok: true as const, listingId: id }),
      ),
    };
    risk = { netFlowAlerts: jest.fn(() => Promise.resolve([])) };
    config = { get: jest.fn((k: string) => Promise.resolve(CONFIG_VALUES[k])) };
    svc = new AdminMarketService(
      market as unknown as MarketService,
      risk as unknown as TradeRiskService,
      config as unknown as GameConfigService,
    );
  });

  describe('status', () => {
    /**
     * 这条是本文件最值钱的一条：将来给 `market.config.ts` 加旋钮时，
     * 若忘了同步 `status()`，它会红。测的是覆盖完整性，不是某个具体字段的值。
     */
    it('摊出 MARKET_CONFIG 的每一项（加了旋钮忘了同步后台就会红）', async () => {
      await svc.status();

      const read = config.get.mock.calls.map(([k]: [string]) => k).sort();
      expect(read).toEqual(Object.keys(MARKET_CONFIG).sort());
    });

    it('原样透出开关与阈值，不做任何换算', async () => {
      expect(await svc.status()).toEqual({
        enabled: CONFIG_VALUES['market.enabled'],
        features: CONFIG_VALUES['market.features'],
        feeBps: CONFIG_VALUES['market.feeBps'],
        listingHours: CONFIG_VALUES['market.listingHours'],
        recycleRateBps: CONFIG_VALUES['market.recycleRateBps'],
        risk: CONFIG_VALUES['market.risk'],
        priceBand: CONFIG_VALUES['market.priceBand'],
      });
    });
  });

  describe('listListings', () => {
    it('筛选条件逐项透传给市场只读层', async () => {
      const q: QueryListingsDto = {
        page: 2,
        pageSize: 50,
        status: 'cancelled',
        mode: 'auction',
        assetCode: 'skin_tiger',
        sellerUserId: 'u9',
      };

      await svc.listListings(q);

      expect(market.adminListings).toHaveBeenCalledWith({
        page: 2,
        pageSize: 50,
        status: 'cancelled',
        mode: 'auction',
        assetCode: 'skin_tiger',
        sellerUserId: 'u9',
      });
    });

    it('不填筛选条件时不伪造默认值（undefined 原样传下去）', async () => {
      await svc.listListings({ page: 1, pageSize: 20 });

      expect(market.adminListings).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        status: undefined,
        mode: undefined,
        assetCode: undefined,
        sellerUserId: undefined,
      });
    });
  });

  describe('forceCancel', () => {
    /**
     * 拆单要退回标的 + 解冻全部活跃出价 + 落终态，只该有一份实现。
     * 一旦有人在后台侧另写一份，漏掉解冻那步就会把买家的钱永久冻死。
     */
    it('委托 MarketService.forceCancel，只传 reason', async () => {
      const dto: ForceCancelListingDto = {
        bizId: 'fc-1',
        reason: '违规挂单',
      };

      expect(await svc.forceCancel('77', dto)).toEqual({
        ok: true,
        listingId: '77',
      });
      expect(market.forceCancel).toHaveBeenCalledWith('77', '违规挂单');
    });

    /** bizId 是幂等键，由拦截器消费；它不该混进市场域的调用参数。 */
    it('bizId 不下传到市场域', async () => {
      await svc.forceCancel('77', { bizId: 'fc-2', reason: 'r' });

      expect(market.forceCancel).toHaveBeenCalledWith('77', 'r');
    });
  });

  describe('netFlow', () => {
    it('days 默认 7、threshold 默认 0，并回显 days', async () => {
      expect(await svc.netFlow({})).toEqual({
        list: [],
        days: 7,
      });
      expect(risk.netFlowAlerts).toHaveBeenCalledWith(7, 0);
    });

    it('显式 days/threshold 生效，且回显的是入参而非默认值', async () => {
      const alert = {
        accountId: 'a1',
        userId: 'u1',
        netOutflow: 5_000,
        days: 30,
      };
      risk.netFlowAlerts.mockResolvedValueOnce([alert]);

      expect(await svc.netFlow({ days: 30, threshold: 1_000 })).toEqual({
        list: [alert],
        days: 30,
      });
      expect(risk.netFlowAlerts).toHaveBeenCalledWith(30, 1_000);
    });

    /** threshold=0 是合法值，不能被 `??` 之外的真值判断吃掉。 */
    it('threshold 显式传 0 不被当成未传', async () => {
      await svc.netFlow({ days: 1, threshold: 0 });

      expect(risk.netFlowAlerts).toHaveBeenCalledWith(1, 0);
    });
  });
});
