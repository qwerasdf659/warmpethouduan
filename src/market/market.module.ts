import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TradingModule } from '../trading/trading.module';
import { MarketController } from './market.controller';
import { MarketQueryService } from './market-query.service';
import { MarketSettleService } from './market-settle.service';
import { MarketService } from './market.service';
import { TradeSettlementService } from './trade-settlement.service';

/**
 * 交易市场域：系统回收 / 定向赠送 / 一价寄售 / 自由竞价。
 *
 * 标的解析、风控、离手清理都来自 `TradingModule`——它们与易货共用，
 * 放在本域会让易货要么 import 市场、要么另写一份。
 */
@Module({
  imports: [AuthModule, LedgerModule, TradingModule],
  controllers: [MarketController],
  providers: [
    MarketService,
    MarketQueryService,
    TradeSettlementService,
    MarketSettleService,
  ],
  exports: [MarketService],
})
export class MarketModule {}
