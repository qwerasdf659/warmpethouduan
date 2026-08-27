import { Injectable } from '@nestjs/common';
import { GameConfigService } from '../../config/game-config.service';
import { MarketService } from '../../market/market.service';
import { TradeRiskService } from '../../market/trade-risk.service';
import type { NetFlowAlert } from '../../market/trade-risk.service';
import {
  ForceCancelListingDto,
  QueryListingsDto,
  QueryNetFlowDto,
} from './dto/market-admin.dto';

/** 市场开关总览：运营需要一眼看出「现在到底开着没有」。 */
export interface MarketStatusView {
  enabled: boolean;
  features: {
    recycle: boolean;
    gift: boolean;
    listing: boolean;
    auction: boolean;
  };
  feeBps: number;
  listingHours: number;
  recycleRateBps: number;
  priceBand: { enabled: boolean; minBps: number; maxBps: number };
  risk: {
    minAccountAgeDays: number;
    maxTradesPerDay: number;
    maxValuePerDay: number;
    abnormalPriceRatio: number;
  };
}

/**
 * 市场后台运营：挂单查询、强制撤单、单向净流出风控清单。
 *
 * 所有市场逻辑都委托 `MarketService` —— 强制撤单要退回标的、解冻全部活跃出价、
 * 落终态，这三步只该有一份实现（复制一份出来早晚会漏掉解冻那步，把买家的钱冻死）。
 * 本类的职责是「把后台的查询意图翻译成市场域的调用」，外加把当前开关状态摊出来看。
 */
@Injectable()
export class AdminMarketService {
  constructor(
    private readonly market: MarketService,
    private readonly risk: TradeRiskService,
    private readonly config: GameConfigService,
  ) {}

  /**
   * 市场当前生效的开关与阈值。
   *
   * 单开这个端点是因为：市场默认全关，而「关着」与「开着但没人挂单」在挂单列表上
   * 长得一模一样（都是空列表）。运营排查「为什么玩家说挂不上单」时，
   * 第一个要看的就是这里。
   */
  async status(): Promise<MarketStatusView> {
    return {
      enabled: await this.config.get('market.enabled'),
      features: await this.config.get('market.features'),
      feeBps: await this.config.get('market.feeBps'),
      listingHours: await this.config.get('market.listingHours'),
      recycleRateBps: await this.config.get('market.recycleRateBps'),
      priceBand: await this.config.get('market.priceBand'),
      risk: await this.config.get('market.risk'),
    };
  }

  listListings(q: QueryListingsDto) {
    return this.market.adminListings({
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      mode: q.mode,
      assetCode: q.assetCode,
      sellerUserId: q.sellerUserId,
    });
  }

  forceCancel(listingId: string, dto: ForceCancelListingDto) {
    return this.market.forceCancel(listingId, dto.reason);
  }

  /**
   * R4 单向净流出清单。
   *
   * **只告警不处置**：「A 长期只送 B」高度可疑但不构成证据 —— 情侣号、师徒关系
   * 都是这个形状。自动封号会误伤，所以这里的产出是一份人工复核清单。
   */
  async netFlow(
    q: QueryNetFlowDto,
  ): Promise<{ list: NetFlowAlert[]; days: number }> {
    const days = q.days ?? 7;
    return {
      list: await this.risk.netFlowAlerts(days, q.threshold ?? 0),
      days,
    };
  }
}
