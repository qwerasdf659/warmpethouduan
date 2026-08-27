import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LockService } from '../common/lock/lock.service';
import { BUSINESS_TZ } from '../common/time/business-day';
import { MarketService } from './market.service';
import { TradeRiskService } from '../trading/trade-risk.service';

/**
 * 市场定时作业：超时挂单处理与竞价结算。
 *
 * 为什么必须有：挂单会冻结玩家资产（唯一物品转入 `ESCROW`、可堆叠资产转为
 * `frozen`），而冻结**没有任何自动释放机制**。没有这个作业，一个无人问津的挂单
 * 会把标的永久锁死 —— 玩家看到的是「东西不见了」。
 *
 * 每 5 分钟一轮而不是每天一次：挂单有效期以小时计，日级精度会让玩家在到期后
 * 最多再等 24 小时才能拿回东西。
 */
@Injectable()
export class MarketSettleService {
  private readonly logger = new Logger('MarketSettle');

  constructor(
    private readonly market: MarketService,
    private readonly risk: TradeRiskService,
    private readonly lock: LockService,
  ) {}

  @Cron('*/5 * * * *', { name: 'market-settle', timeZone: BUSINESS_TZ })
  async settleExpired(): Promise<void> {
    if ((process.env.NODE_APP_INSTANCE ?? '0') !== '0') return;

    await this.lock.withLock(
      'market:settle',
      async () => {
        const ids = await this.market.findExpiredListings();
        if (ids.length === 0) return;

        let ok = 0;
        for (const id of ids) {
          try {
            // 逐个处理而不是批量事务：一个挂单的结算失败（如买家账号被封）
            // 不该让其余 199 个继续挂着
            await this.market.handleExpired(id);
            ok += 1;
          } catch (err) {
            this.logger.error(
              `挂单 ${id} 超时处理失败：${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        this.logger.log(`超时挂单处理：${ok}/${ids.length} 成功`);
      },
      // 抢不到锁说明上一轮还在跑（挂单多时可能超过 5 分钟），跳过本轮
      { ttlMs: 280_000, retries: 0 },
    );
  }

  /**
   * R4 单向净流出日报。每天 04:20，紧随对账之后。
   *
   * 只告警不处置：「A 长期只送 B」高度可疑但不构成证据 —— 情侣号、师徒关系
   * 都是这个形状。自动封号会误伤，所以这里的产出是一份人工复核清单。
   */
  @Cron('20 4 * * *', { name: 'market-netflow', timeZone: BUSINESS_TZ })
  async netFlowReport(): Promise<void> {
    if ((process.env.NODE_APP_INSTANCE ?? '0') !== '0') return;

    const alerts = await this.risk.netFlowAlerts(7, 0);
    if (alerts.length === 0) {
      this.logger.log('净流出日报：近 7 日无单向净流出账户');
      return;
    }
    this.logger.warn(
      `净流出日报：${alerts.length} 个账户近 7 日为净流出，前 10 名如下（疑似洗号/代练，需人工复核）`,
    );
    for (const a of alerts.slice(0, 10)) {
      this.logger.warn(
        `  user=${a.userId ?? '(系统)'} account=${a.accountId} 净流出=${a.netOutflow}`,
      );
    }
  }
}
