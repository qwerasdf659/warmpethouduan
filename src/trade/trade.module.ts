import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { TradeOffer } from '../entities/trade-offer.entity';
import { TradeOfferItem } from '../entities/trade-offer-item.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { TradingModule } from '../trading/trading.module';
import { TradeController } from './trade.controller';

import { TradeService } from './trade.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeOffer, TradeOfferItem]),
    AuthModule,
    EconomyModule,
    LedgerModule,
    TradingModule,
  ],
  controllers: [TradeController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradeModule {}
